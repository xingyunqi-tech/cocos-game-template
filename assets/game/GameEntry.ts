import { ads, bootPipeline, coreOptions, preloadBundle, setGameEntry } from 'db://game-core';
import { DemoApp, PLACEMENTS, SIDEBAR_REWARD } from './demo/DemoApp';
import { DEMO_BUNDLE, registerDemoUI } from './demo/ui';

coreOptions.sidebarEntry.rewardText = `从抖音首页侧边栏进入游戏，每天可领取 ${SIDEBAR_REWARD} 金币`;
coreOptions.clickSound = { bundle: DEMO_BUNDLE, path: 'audio/click' };

ads.configure({
    rewarded: { [PLACEMENTS.doubleScore]: 'adunit-rewarded-placeholder' },
    interstitial: { [PLACEMENTS.backToMenu]: 'adunit-interstitial-placeholder' },
});

bootPipeline.register(
    'demo-bundle',
    async (step) => {
        await preloadBundle(DEMO_BUNDLE, (ratio) => step.progress(ratio));
    },
    { after: 'remote-config', weight: 3, timeoutMs: 30000 },
);

setGameEntry(() => {
    registerDemoUI();
    new DemoApp().start();
});
