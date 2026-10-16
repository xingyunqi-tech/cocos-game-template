import { ads, coreOptions, setGameEntry } from 'db://game-core';
import { DemoApp, PLACEMENTS, SIDEBAR_REWARD } from './demo/DemoApp';

coreOptions.sidebarEntry.rewardText = `从抖音首页侧边栏进入游戏，每天可领取 ${SIDEBAR_REWARD} 金币`;

ads.configure({
    rewarded: { [PLACEMENTS.doubleScore]: 'adunit-rewarded-placeholder' },
    interstitial: { [PLACEMENTS.backToMenu]: 'adunit-interstitial-placeholder' },
});

setGameEntry(() => new DemoApp().start());
