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
        if (path === '/__smoke/echo') {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null, body }));
            });
            return;
        }
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
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(msg.text()));
try {
    await page.goto(`http://127.0.0.1:${port}/?smoke=1`);
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

    await page.waitForFunction(() => Boolean(window.gameCore), null, { timeout: 5000 });
    const stepNames = await page.evaluate(() => window.gameCore.bootPipeline.stepNames);
    checks.push(`启动流水线步骤：${stepNames.join(' → ')}`);
    if (!consoleLines.some((line) => line.includes('boot_done'))) throw new Error('启动流水线未完成（未见 boot_done）');
    checks.push('启动流水线完成');

    const net = await page.evaluate(async (origin) => {
        const { http, mockTransport, HttpClient, XhrTransport } = window.gameCore;
        mockTransport.on('GET', '/smoke', () => ({ body: { ok: true } }));
        const mocked = await http.get('smoke');
        const xhr = new HttpClient({ transport: new XhrTransport(), baseUrl: origin });
        const echoed = await xhr.post('__smoke/echo', { a: 1 }, { headers: { Authorization: 'Bearer t' } });
        return { mocked: mocked.data, echoed: echoed.data };
    }, `http://127.0.0.1:${port}`);
    if (!net.mocked?.ok) throw new Error(`Mock 请求失败：${JSON.stringify(net)}`);
    if (net.echoed?.method !== 'POST' || net.echoed.body !== '{"a":1}' || net.echoed.auth !== 'Bearer t') {
        throw new Error(`XHR 请求结果不符：${JSON.stringify(net)}`);
    }
    checks.push('HttpClient：Mock 与 XHR 请求均正常');

    const saved = await page.evaluate(async () => {
        const slot = window.gameCore.deviceSave.slot('smoke', { version: 1, defaults: () => ({ n: 0 }) });
        slot.set({ n: 1 });
        const before = localStorage.getItem('gc:d:smoke');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        const after = localStorage.getItem('gc:d:smoke');
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        localStorage.removeItem('gc:d:smoke');
        return { before, after };
    });
    if (saved.before !== null || saved.after === null) throw new Error(`切后台未落盘：${JSON.stringify(saved)}`);
    checks.push('切后台时存档立即落盘');
    const platform = await page.evaluate(async () => {
        const { platform, auth, userSave, ads, network, sidebar } = window.gameCore;
        const slot = userSave.slot('smoke', { version: 1, defaults: () => ({ n: 0 }) });
        slot.set({ n: 2 });
        userSave.flush();
        const userKey = Object.keys(localStorage).find((k) => k.startsWith('gc:u:') && k.endsWith(':smoke'));
        slot.reset();
        return {
            name: platform.name,
            envVersion: platform.getEnvVersion(),
            userId: auth.userId,
            hasToken: Boolean(auth.getToken()),
            userKey,
            rewarded: await ads.showRewarded('smoke'),
            online: network.online,
            sidebar: await sidebar.isSupported(),
            launchQuery: platform.getLaunchOptions().query,
        };
    });
    if (platform.name !== 'web') throw new Error(`平台识别错误：${platform.name}`);
    checks.push(`平台 ${platform.name}（${platform.envVersion}）`);
    if (!platform.userId.startsWith('mock-') || !platform.hasToken)
        throw new Error(`登录失败：${JSON.stringify(platform)}`);
    if (!consoleLines.some((line) => line.includes('登录成功'))) throw new Error('启动流水线未执行登录步骤');
    checks.push(`Mock 登录成功，userId ${platform.userId}`);
    if (platform.userKey !== `gc:u:${platform.userId}:smoke`)
        throw new Error(`用户存档未按 userId 隔离：${platform.userKey}`);
    checks.push('用户存档按 userId 隔离');
    if (platform.rewarded.result !== 'completed')
        throw new Error(`Web 调试广告结果不符：${JSON.stringify(platform.rewarded)}`);
    checks.push('Web 调试激励广告返回 completed');
    if (!platform.online || platform.sidebar) throw new Error(`网络或侧边栏状态不符：${JSON.stringify(platform)}`);
    checks.push('网络在线；Web 不支持侧边栏');
    if (platform.launchQuery.smoke !== '1') throw new Error(`启动参数未解析：${JSON.stringify(platform.launchQuery)}`);
    checks.push('启动参数从 URL 解析');

    const offline = await page.evaluate(async () => {
        const seen = [];
        const off = window.gameCore.network.onChange((online) => seen.push(online));
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
        off();
        return seen;
    });
    if (offline.join() !== 'false,true') throw new Error(`断网事件未上报：${JSON.stringify(offline)}`);
    checks.push('断网与恢复事件均触发');

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
