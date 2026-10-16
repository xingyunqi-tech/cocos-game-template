import { profiler, type Node } from 'cc';
import type { PayResult } from '../payment/types';
import type { RewardedResult } from '../platform/types';
import {
    THEME,
    addButton,
    addLabel,
    addPanel,
    createNode,
    getLayer,
    openModal,
    setButtonText,
    visibleSize,
} from '../ui/kit';

export interface GmActions {
    envTypes: string[];
    currentEnv: () => string;
    setEnv: (type: string) => void;
    adSimulation: () => RewardedResult['result'] | null;
    setAdSimulation: (value: RewardedResult['result'] | null) => void;
    paySimulation: () => PayResult['result'] | null;
    setPaySimulation: (value: PayResult['result'] | null) => void;
    simulateSidebar: () => void;
    clearSaves: () => void;
    confirm: (content: string) => Promise<boolean>;
    toast: (text: string) => void;
    /** 重新加载游戏；不支持时返回 false，由调用方提示手动重启 */
    restart: () => boolean;
}

const AD_MODES: Array<RewardedResult['result'] | null> = [null, 'completed', 'skipped', 'failed'];
const AD_LABEL: Record<string, string> = { null: '关闭', completed: '完成', skipped: '跳过', failed: '失败' };
const PAY_MODES: Array<PayResult['result'] | null> = [null, 'success', 'failed'];
const PAY_LABEL: Record<string, string> = { null: '关闭', success: '成功', failed: '失败' };
const WIDTH = 600;
const HEIGHT = 840;

/** 调试面板入口按钮 */
export function installGmButton(actions: GmActions): Node | null {
    const layer = getLayer('LayerNotify');
    if (!layer || layer.getChildByName('GmButton')) return null;
    const { width, height } = visibleSize();
    const button = addButton(layer, 'GM', () => openGmPanel(actions), {
        width: 88,
        height: 88,
        color: THEME.text,
        fontSize: 28,
    });
    button.name = 'GmButton';
    button.setPosition(width / 2 - 70, -height / 2 + 200);
    return button;
}

export function openGmPanel(actions: GmActions) {
    if (getLayer('LayerSystem')?.getChildByName('GmPanel')) return null;
    const modal = openModal('LayerSystem', 'GmPanel');
    if (!modal) return null;
    const panel = addPanel(modal.root, WIDTH, HEIGHT);
    addLabel(panel, 'GM 调试', { fontSize: THEME.titleSize, width: WIDTH - 60 }).node.setPosition(0, HEIGHT / 2 - 60);

    const row = (index: number, label: string) => {
        const y = HEIGHT / 2 - 140 - index * 88;
        addLabel(panel, label, { width: 180, align: 'left', fontSize: 26 }).node.setPosition(-WIDTH / 2 + 120, y);
        const area = createNode(`Row_${index}`, panel, WIDTH - 220, 70);
        area.setPosition(90, y);
        return area;
    };

    const envRow = row(0, '环境');
    actions.envTypes.forEach((type, i) => {
        const current = actions.currentEnv() === type;
        const button = addButton(
            envRow,
            type,
            () => {
                if (current) return;
                void actions.confirm(`切换到 ${type} 环境并重启？`).then((ok) => {
                    if (!ok) return;
                    actions.setEnv(type);
                    if (!actions.restart()) actions.toast('已设置，重新打开游戏后生效');
                });
            },
            {
                width: 110,
                height: 60,
                fontSize: 24,
                color: current ? THEME.primary : THEME.secondary,
                textColor: current ? THEME.primaryText : THEME.secondaryText,
            },
        );
        button.name = `Env_${type}`;
        button.setPosition(-120 + i * 125, 0);
    });

    const adButton = addButton(
        row(1, '广告模拟'),
        AD_LABEL[String(actions.adSimulation())],
        () => {
            const next = AD_MODES[(AD_MODES.indexOf(actions.adSimulation()) + 1) % AD_MODES.length];
            actions.setAdSimulation(next);
            setButtonText(adButton, AD_LABEL[String(next)], next ? THEME.primary : THEME.subText);
        },
        { width: 200, height: 60, fontSize: 24 },
    );
    adButton.name = 'AdSimulation';
    setButtonText(
        adButton,
        AD_LABEL[String(actions.adSimulation())],
        actions.adSimulation() ? THEME.primary : THEME.subText,
    );

    const payButton = addButton(
        row(2, '支付模拟'),
        PAY_LABEL[String(actions.paySimulation())],
        () => {
            const next = PAY_MODES[(PAY_MODES.indexOf(actions.paySimulation()) + 1) % PAY_MODES.length];
            actions.setPaySimulation(next);
            setButtonText(payButton, PAY_LABEL[String(next)], next ? THEME.primary : THEME.subText);
        },
        { width: 200, height: 60, fontSize: 24 },
    );
    payButton.name = 'PaySimulation';
    setButtonText(
        payButton,
        PAY_LABEL[String(actions.paySimulation())],
        actions.paySimulation() ? THEME.primary : THEME.subText,
    );

    addButton(
        row(3, '侧边栏'),
        '模拟进入',
        () => {
            actions.simulateSidebar();
            actions.toast('已按侧边栏进入处理');
        },
        { width: 200, height: 60, fontSize: 24 },
    ).name = 'SimulateSidebar';

    const statsButton = addButton(
        row(4, '性能面板'),
        profiler.isShowingStats() ? '隐藏' : '显示',
        () => {
            if (profiler.isShowingStats()) profiler.hideStats();
            else profiler.showStats();
            setButtonText(statsButton, profiler.isShowingStats() ? '隐藏' : '显示');
        },
        { width: 200, height: 60, fontSize: 24 },
    );

    addButton(
        row(5, '存档'),
        '清空并重启',
        () => {
            void actions.confirm('清空设备与用户存档并重启？').then((ok) => {
                if (!ok) return;
                actions.clearSaves();
                if (!actions.restart()) actions.toast('已设置，重新打开游戏后生效');
            });
        },
        { width: 200, height: 60, fontSize: 24, color: THEME.banner },
    ).name = 'ClearSaves';

    addButton(panel, '关闭', () => modal.close()).setPosition(0, -HEIGHT / 2 + 70);
    return modal;
}
