/** smoke-web 在通用检查之后调用：检查示例游戏；业务游戏替换为自己的检查，或删除本文件只做通用检查 */
export default async function smokeGame({ browser, page, origin, checks, pageErrors, timeout }) {
    const table = await page.evaluate(() => window.gameCore.Tables.get('demo_level', 1)?.name);
    if (table !== '入门') throw new Error(`配置表未加载：${table}`);
    checks.push('配置表 demo_level 已加载');

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
    const bundleUi = await page.evaluate(async () => {
        const scene = window.cc.director.getScene();
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const until = async (check, ms = 10000) => {
            const deadline = Date.now() + ms;
            while (!check()) {
                if (Date.now() > deadline) throw new Error('等待超时');
                await wait(50);
            }
        };
        const dialog = () => scene.getChildByPath('root/gui/LayerDialog/rank');
        const bundleBeforeOpen = Boolean(window.cc.assetManager.getBundle('demo'));
        scene.getChildByPath('root/gui/LayerUI/DemoMenu/Button_排行榜').emit('touch-end');
        await until(() => Boolean(dialog()));
        const label = (name) =>
            dialog()
                .getChildByPath(`Panel/${name}`)
                .components.find((c) => typeof c.string === 'string').string;
        const result = {
            bundle: bundleBeforeOpen,
            title: label('Title'),
            list: label('List'),
        };
        dialog().getChildByPath('Panel/CloseButton').emit('touch-end');
        await until(() => !dialog());
        const music = window.oops.audio.music;
        const source = music.components.find((c) => 'clip' in c);
        result.musicClip = source?.clip?.name ?? null;
        result.musicPlaying = Boolean(source?.playing);
        return result;
    });
    if (!bundleUi.bundle) throw new Error('demo Bundle 未加载');
    checks.push('业务 Bundle demo 已在启动流水线中加载');
    if (!bundleUi.title.startsWith('最高分') || !bundleUi.list.includes('第 1 局')) {
        throw new Error(`prefab 界面未收到参数：${JSON.stringify(bundleUi)}`);
    }
    checks.push('prefab 界面经 oops.gui.open 打开、接收参数并关闭');
    if (bundleUi.musicClip !== 'bgm' || !bundleUi.musicPlaying) {
        throw new Error(`背景音乐未播放：${JSON.stringify(bundleUi)}`);
    }
    checks.push('背景音乐从 Bundle 加载并播放');

    const retryPage = await browser.newPage({ viewport: { width: 720, height: 1280 } });
    retryPage.on('pageerror', (err) => pageErrors.push(`重试页：${err.message}`));
    const bundleRequests = { blocked: 0, allowed: 0 };
    let blockBundle = true;
    await retryPage.route('**/assets/demo/config*.json', (route) => {
        if (blockBundle) {
            bundleRequests.blocked++;
            return route.abort();
        }
        bundleRequests.allowed++;
        return route.continue();
    });
    await retryPage.goto(`${origin}/?smoke=1`);
    await retryPage.waitForFunction(
        () => Boolean(window.cc?.director.getScene()?.getChildByPath('root/gui/BootFailed')),
        null,
        { timeout },
    );
    const failedText = await retryPage.evaluate(
        () =>
            window.cc.director
                .getScene()
                .getChildByPath('root/gui/BootFailed')
                .components.find((c) => typeof c.string === 'string').string,
    );
    if (failedText !== '启动失败，点击重试') throw new Error(`启动失败提示不符：${failedText}`);
    blockBundle = false;
    await retryPage.evaluate(() =>
        window.cc.director.getScene().getChildByPath('root/gui/BootFailed').emit('touch-end'),
    );
    await retryPage.waitForFunction(
        () => {
            const scene = window.cc.director.getScene();
            return (
                Boolean(scene.getChildByPath('root/gui/LayerUI/DemoMenu')) &&
                !scene.getChildByPath('root/gui/BootFailed')
            );
        },
        null,
        { timeout },
    );
    if (bundleRequests.blocked === 0 || bundleRequests.allowed === 0) {
        throw new Error(`demo Bundle 请求次数不符：${JSON.stringify(bundleRequests)}`);
    }
    checks.push('启动步骤失败时显示重试，点击后重新执行流水线并进入首页');
    await retryPage.close();
}
