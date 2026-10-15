import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { PLATFORMS, ROOT } from './lib/cocos.mjs';

const { values } = parseArgs({
    options: {
        dir: { type: 'string', default: join(ROOT, 'build', PLATFORMS.web) },
        chrome: { type: 'string', default: process.env.CHROME_PATH },
        screenshot: { type: 'string' },
        timeout: { type: 'string', default: '30000' },
    },
});

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.bin': 'application/octet-stream',
};

const DEFAULT_CHROME = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    linux: '/usr/bin/google-chrome',
};

if (!existsSync(join(values.dir, 'index.html'))) {
    console.error(`未找到 Web 构建产物：${values.dir}，先执行 npm run build -- web --debug`);
    process.exit(1);
}

const server = http
    .createServer(async (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = normalize(join(values.dir, path === '/' ? 'index.html' : path));
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end();
        }
    })
    .listen(0);

const port = server.address().port;
const browser = await chromium.launch({
    executablePath: values.chrome ?? DEFAULT_CHROME[process.platform],
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
const ALLOWED_MISSING = new Set(['/favicon.ico']);
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) pageErrors.push(msg.text());
});
page.on('response', (res) => {
    if (res.status() >= 400 && !ALLOWED_MISSING.has(new URL(res.url()).pathname)) {
        pageErrors.push(`HTTP ${res.status()} ${res.url()}`);
    }
});
page.on('requestfailed', (req) => pageErrors.push(`请求失败 ${req.url()}`));

const checks = [];
try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => Boolean(window.oops?.gui?.root), null, { timeout: Number(values.timeout) });
    checks.push('oops 初始化完成');

    const env = await page.evaluate(() => ({
        type: window.oops.config.game._data.type,
        httpServer: window.oops.config.game.data.httpServer,
    }));
    if (!env.httpServer) throw new Error(`环境 ${env.type} 缺少 httpServer`);
    checks.push(`环境 ${env.type} → ${env.httpServer}`);

    const servers = await page.evaluate(() => {
        const config = window.oops.config.game;
        const result = {};
        for (const type of ['dev', 'test', 'prod']) {
            config.setConfigType(type);
            result[type] = config.data.httpServer;
        }
        config.setConfigType(config._data.type);
        return result;
    });
    if (new Set(Object.values(servers)).size !== 3)
        throw new Error(`各环境 httpServer 未区分：${JSON.stringify(servers)}`);
    checks.push('dev / test / prod 切换后 httpServer 各不相同');

    const layers = await page.evaluate(() =>
        window.cc.director
            .getScene()
            .getChildByPath('root/gui')
            .children.map((n) => n.name),
    );
    if (!layers.includes('LayerNotify')) throw new Error(`界面层缺少 LayerNotify：${layers.join(',')}`);
    checks.push(`界面层 ${layers.length} 个`);

    await page.evaluate(() => window.oops.gui.toast('smoke'));
    await page.waitForFunction(
        () => Boolean(window.cc.director.getScene().getChildByPath('root/gui/LayerNotify/notify/item')),
        null,
        { timeout: 5000 },
    );
    checks.push('Toast 节点已渲染');
    if (values.screenshot) await page.screenshot({ path: values.screenshot });
} catch (err) {
    pageErrors.push(`检查失败：${err.message}`);
} finally {
    await browser.close();
    server.close();
}

for (const line of checks) console.log(`✓ ${line}`);
if (pageErrors.length > 0) {
    for (const line of pageErrors) console.error(`✗ ${line}`);
    process.exit(1);
}
