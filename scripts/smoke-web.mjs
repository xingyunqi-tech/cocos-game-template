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
        'skip-demo': { type: 'boolean', default: false },
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
    const bootDeadline = Date.now() + 10000;
    while (!consoleLines.some((line) => line.includes('boot_done')) && Date.now() < bootDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

    const ui = await page.evaluate(async () => {
        const { coreUi, settings, defaultPrivacyPrompt, getDesignInset, sidebarReward, healthNotice } = window.gameCore;
        const scene = window.cc.director.getScene();
        const find = (path) => scene.getChildByPath(`root/gui/${path}`);
        const tap = (node) => {
            const size = node.getComponent('cc.UITransform')?.contentSize;
            if (!size || size.width <= 0 || size.height <= 0) throw new Error(`按钮尺寸为 0：${node.name}`);
            node.emit('touch-end');
        };
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const result = { healthHidden: !healthNotice.visible, inset: getDesignInset().top };

        coreUi.openSettings();
        const vibrationBefore = settings.vibration;
        tap(find('LayerDialog/SettingsPanel/Panel/Toggle_vibration'));
        result.vibrationToggled = settings.vibration === !vibrationBefore;
        settings.vibration = vibrationBefore;
        tap(find('LayerDialog/SettingsPanel/Panel/Button_关闭'));
        await wait(50);
        result.settingsClosed = !find('LayerDialog/SettingsPanel');

        await coreUi.openDocument('privacy');
        const doc = find('LayerSystem/Document_privacy');
        const text = doc
            ?.getChildByPath('Viewport/Content/Label')
            ?.components.find((c) => typeof c.string === 'string');
        result.privacyText = text?.string.slice(0, 6);
        result.privacyLines = doc?.getChildByPath('Viewport/Content')?.children.length ?? 0;
        tap(doc.getChildByName('Button_返回'));
        await wait(50);
        result.documentClosed = !find('LayerSystem/Document_privacy');

        const decide = async (button) => {
            const pending = defaultPrivacyPrompt({ openContract: () => undefined });
            await wait(0);
            const dialogs = find('LayerSystem').children.filter((n) => n.name === 'ConfirmDialog');
            tap(dialogs[dialogs.length - 1].getChildByPath(`Panel/${button}`));
            const agree = await pending;
            await wait(50);
            return agree;
        };
        result.privacyAgree = await decide('Button_同意');
        result.privacyDisagree = await decide('Button_拒绝');
        result.dialogClosed = !find('LayerSystem/ConfirmDialog');

        window.dispatchEvent(new Event('offline'));
        result.bannerShown = Boolean(find('LayerNotify/OfflineBanner'));
        window.dispatchEvent(new Event('online'));
        await wait(50);
        result.bannerHidden = !find('LayerNotify/OfflineBanner');

        result.sidebarEntry = await coreUi.createSidebarEntry(find('LayerUI'));
        result.sidebarReward = sidebarReward.canClaim();
        return result;
    });
    if (!ui.healthHidden) throw new Error('启动完成后健康忠告加载页未关闭');
    checks.push('健康忠告加载页在启动完成后关闭');
    if (ui.inset !== 20) throw new Error(`Web 顶部避让应为默认 20，实际 ${ui.inset}`);
    checks.push('Web 顶部避让使用默认内边距');
    if (!ui.vibrationToggled || !ui.settingsClosed) throw new Error(`设置面板异常：${JSON.stringify(ui)}`);
    checks.push('设置面板切换震动并关闭');
    if (ui.privacyText !== '【模板占位】' || ui.privacyLines < 10 || !ui.documentClosed)
        throw new Error(`协议页异常：${JSON.stringify(ui)}`);
    checks.push('隐私政策页加载文本并可返回');
    if (ui.privacyAgree !== true || ui.privacyDisagree !== false || !ui.dialogClosed) {
        throw new Error(`隐私弹窗结果不符：${JSON.stringify(ui)}`);
    }
    checks.push('隐私弹窗同意、拒绝两条路径均返回并关闭');
    if (!ui.bannerShown || !ui.bannerHidden) throw new Error(`断网横幅异常：${JSON.stringify(ui)}`);
    checks.push('断网横幅出现与消失');
    if (ui.sidebarEntry !== null || ui.sidebarReward) throw new Error(`Web 不应有侧边栏入口：${JSON.stringify(ui)}`);
    checks.push('Web 不创建侧边栏入口');

    const p1 = await page.evaluate(async () => {
        const { Tables, ads } = window.gameCore;
        const gm = window.cc.director.getScene().getChildByPath('root/gui/LayerNotify/GmButton');
        ads.simulate = 'skipped';
        const simulated = await ads.showRewarded('gm');
        ads.simulate = null;
        return { level: Tables.get('demo_level', 1)?.name, gm: Boolean(gm), simulated: simulated.result };
    });
    if (p1.level !== '入门') throw new Error(`配置表未加载：${JSON.stringify(p1)}`);
    checks.push('配置表 demo_level 已加载');
    if (!p1.gm || p1.simulated !== 'skipped') throw new Error(`GM 调试异常：${JSON.stringify(p1)}`);
    checks.push('GM 按钮已创建，广告模拟生效');
    if (!consoleLines.some((line) => line.includes('远程配置来源') && line.includes('remote'))) {
        throw new Error('远程配置未从 mock 接口加载');
    }
    checks.push('远程配置从接口加载');

    if (values['skip-demo']) {
        const hasDemo = await page.evaluate(() =>
            Boolean(window.cc.director.getScene().getChildByPath('root/gui/LayerUI/DemoMenu')),
        );
        if (hasDemo) throw new Error('--skip-demo 时不应出现示例游戏');
        if (!consoleLines.some((line) => line.includes('未注册游戏入口'))) throw new Error('未执行游戏入口检查');
        checks.push('未注册游戏入口时启动正常');
    } else {
        await page.waitForFunction(
            () => Boolean(window.cc.director.getScene().getChildByPath('root/gui/LayerUI/DemoMenu')),
            null,
            { timeout: 10000 },
        );
        checks.push('示例游戏首页已显示');
        const demo = await page.evaluate(async () => {
            const scene = window.cc.director.getScene();
            const find = (path) => scene.getChildByPath(`root/gui/LayerUI/${path}`);
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const until = async (check, ms = 10000) => {
                const deadline = Date.now() + ms;
                while (!check()) {
                    if (Date.now() > deadline) throw new Error('等待超时');
                    await wait(50);
                }
            };
            const coins = () => {
                const label = find('DemoMenu/Coins')?.components.find((c) => typeof c.string === 'string');
                return label?.string;
            };
            const before = coins();
            find('DemoMenu/Button_开始游戏').emit('touch-end');
            await until(() => find('DemoPlay/Field')?.children.length > 0);
            const field = find('DemoPlay/Field');
            const hits = field.children.length;
            field.children.slice().forEach((target) => target.emit('touch-start'));
            field.components.find((c) => 'duration' in c).remaining = 0.01;
            await until(() => Boolean(find('DemoResult')));
            const score = Number(
                /\d+/.exec(
                    find('DemoResult')
                        .children.map((n) => n.components.find((c) => typeof c.string === 'string')?.string ?? '')
                        .find((t) => t.startsWith('得分')),
                )[0],
            );
            find('DemoResult/Button_看广告 金币翻倍').emit('touch-end');
            await until(() => !find('DemoResult/Button_看广告 金币翻倍')?.parent);
            window.gameCore.userSave.flush();
            const saved = Object.entries(localStorage).find(([key]) => key.endsWith(':demo'));
            find('DemoResult/Button_返回首页').emit('touch-end');
            await until(() => Boolean(find('DemoMenu')));
            return { before, after: coins(), hits, score, saved: saved && JSON.parse(saved[1]) };
        });
        if (demo.score !== demo.hits || demo.hits === 0) throw new Error(`得分与点击数不符：${JSON.stringify(demo)}`);
        checks.push(`示例游戏完成一局，得分 ${demo.score}`);
        const expected = demo.score * 2;
        if (demo.saved?.d?.coins !== expected || demo.saved.d.plays !== 1 || demo.saved.d.best !== demo.score) {
            throw new Error(`存档不符：${JSON.stringify(demo)}`);
        }
        if (demo.after !== `金币 ${expected}`) throw new Error(`首页金币未刷新：${JSON.stringify(demo)}`);
        checks.push('激励视频翻倍金币并写入用户存档，返回首页后显示');
        const sidebarCoins = await page.evaluate(async () => {
            window.gameCore.simulateSidebarLaunch();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const label = window.cc.director
                .getScene()
                .getChildByPath('root/gui/LayerUI/DemoMenu/Coins')
                ?.components.find((c) => typeof c.string === 'string');
            return label?.string;
        });
        if (sidebarCoins !== `金币 ${expected + 100}`) throw new Error(`侧边栏复访奖励未发放：${sidebarCoins}`);
        checks.push('模拟侧边栏进入后发放复访奖励');
    }

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
