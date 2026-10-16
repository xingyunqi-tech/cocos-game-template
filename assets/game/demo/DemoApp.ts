import { Color, type Node } from 'cc';
import {
    addButton,
    addLabel,
    ads,
    coreUi,
    createNode,
    destroyNow,
    fillRect,
    getDesignInset,
    getLayer,
    onSidebarLaunch,
    platform,
    settings,
    sidebarReward,
    Tables,
    THEME,
    track,
    visibleSize,
    type ShareOptions,
} from 'db://game-core';
import { demoSave } from './DemoSave';
import { TapGame } from './TapGame';

export const SIDEBAR_REWARD = 100;
export const PLACEMENTS = { doubleScore: 'double_score', backToMenu: 'back_to_menu' };

const BACKGROUND = new Color(250, 246, 238, 255);
const SHARE: ShareOptions = { title: '来点点乐挑战我的最高分！', query: 'from=share' };

/** 示例游戏：首页 → 限时点击 → 结算（激励视频双倍、分享） */
export class DemoApp {
    private screen: Node | null = null;

    start() {
        platform.setShareMenu(SHARE);
        onSidebarLaunch(() => {
            if (!sidebarReward.claim()) return;
            demoSave.addCoins(SIDEBAR_REWARD);
            coreUi.toast(`侧边栏复访奖励：金币 +${SIDEBAR_REWARD}`);
            track('sidebar_reward', { amount: SIDEBAR_REWARD });
            if (this.screen?.name === 'DemoMenu') this.showMenu();
        });
        this.showMenu();
    }

    showMenu() {
        const screen = this.openScreen('DemoMenu');
        const { width, height } = visibleSize();
        const top = height / 2 - getDesignInset().top;
        const data = demoSave.get();

        const coins = addLabel(screen, `金币 ${data.coins}`, { width: 240, align: 'left', color: THEME.text });
        coins.node.name = 'Coins';
        coins.node.setPosition(-width / 2 + 160, top - 40);
        const settingsButton = addButton(screen, '设置', () => coreUi.openSettings(), {
            width: 120,
            height: 64,
            color: THEME.secondary,
            textColor: THEME.secondaryText,
            fontSize: 26,
        });
        settingsButton.setPosition(width / 2 - 90, top - 40);
        void coreUi.createSidebarEntry(screen).then((entry) => entry?.setPosition(width / 2 - 90, top - 120));

        addLabel(screen, '点点乐', { fontSize: 72, width: width - 80 }).node.setPosition(0, 260);
        addLabel(screen, `最高分 ${data.best} · 已玩 ${data.plays} 局`, {
            fontSize: 28,
            width: width - 80,
            color: THEME.subText,
        }).node.setPosition(0, 160);
        addButton(screen, '开始游戏', () => this.play(), { width: 360, height: 100, fontSize: 36 }).setPosition(0, -20);
        addButton(screen, '分享给好友', () => void platform.share(SHARE), {
            width: 360,
            height: 88,
            color: THEME.secondary,
            textColor: THEME.secondaryText,
        }).setPosition(0, -140);
    }

    play() {
        const screen = this.openScreen('DemoPlay');
        const { width, height } = visibleSize();
        const top = height / 2 - getDesignInset().top;
        const score = addLabel(screen, '得分 0', { width: 300, align: 'left' });
        score.node.setPosition(-width / 2 + 180, top - 40);
        const timer = addLabel(screen, '', { width: 200, align: 'right' });
        timer.node.setPosition(width / 2 - 140, top - 40);

        const field = createNode('Field', screen, width - 40, height - getDesignInset().top - 200);
        field.setPosition(0, -60);
        const game = field.addComponent(TapGame);
        const level = Tables.get('demo_level', 1);
        if (level) {
            game.duration = level.duration;
            game.spawnInterval = level.spawnInterval;
            game.targetLife = level.targetLife;
            game.radius = level.radius;
        }
        game.onScore = (value) => {
            score.string = `得分 ${value}`;
            settings.vibrate('short');
        };
        game.onTick = (remaining) => (timer.string = `${remaining}s`);
        game.onFinish = (value) => this.showResult(value);
        track('game_start');
        game.begin();
    }

    showResult(score: number) {
        const record = demoSave.recordGame(score);
        track('game_end', { score, record });
        const screen = this.openScreen('DemoResult');
        addLabel(screen, record ? '新纪录！' : '本局结束', { fontSize: 48, width: 600 }).node.setPosition(0, 300);
        const scoreLabel = addLabel(screen, `得分 ${score}`, { fontSize: 64, width: 600 });
        scoreLabel.node.setPosition(0, 190);
        addLabel(screen, `最高分 ${demoSave.get().best}`, {
            fontSize: 28,
            width: 600,
            color: THEME.subText,
        }).node.setPosition(0, 110);

        let doubled = false;
        let busy = false;
        const active = () => this.screen === screen && !busy;
        const double = addButton(
            screen,
            '看广告 金币翻倍',
            () => {
                if (doubled || !active()) return;
                busy = true;
                void ads.showRewarded(PLACEMENTS.doubleScore).then((result) => {
                    busy = false;
                    if (this.screen !== screen) return;
                    if (result.result === 'completed') {
                        doubled = true;
                        demoSave.addCoins(score);
                        coreUi.toast(`金币 +${score}`);
                        destroyNow(double);
                    } else if (result.result === 'skipped') {
                        coreUi.toast('完整观看广告才能获得奖励');
                    } else {
                        coreUi.toast('广告暂时不可用');
                    }
                });
            },
            { width: 400, height: 96 },
        );
        double.setPosition(0, -20);
        addButton(
            screen,
            '炫耀成绩',
            () => active() && void platform.share({ ...SHARE, title: `我在点点乐得了 ${score} 分！` }),
            {
                width: 400,
                height: 88,
                color: THEME.secondary,
                textColor: THEME.secondaryText,
            },
        ).setPosition(0, -140);
        addButton(screen, '再来一局', () => active() && this.play(), { width: 190, height: 80 }).setPosition(
            -105,
            -260,
        );
        addButton(
            screen,
            '返回首页',
            () => {
                if (!active()) return;
                busy = true;
                void ads.showInterstitial(PLACEMENTS.backToMenu).then(() => {
                    if (this.screen === screen) this.showMenu();
                });
            },
            { width: 190, height: 80, color: THEME.secondary, textColor: THEME.secondaryText },
        ).setPosition(105, -260);
    }

    private openScreen(name: string): Node {
        destroyNow(this.screen);
        const layer = getLayer('LayerUI')!;
        const { width, height } = visibleSize();
        const screen = createNode(name, layer, width, height);
        fillRect(screen, BACKGROUND);
        this.screen = screen;
        return screen;
    }
}
