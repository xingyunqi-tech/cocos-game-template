import { SidebarReward } from '../compliance/SidebarReward';
import { reportError } from '../monitor/errors';
import { platform, serverTime, userSave } from './services';

let sidebarSimulated = false;
let sidebarListeners: Array<() => void> = [];
let pendingSidebarListeners: Array<() => void> = [];

export const sidebar = {
    isSupported: () => platform.sidebar.isSupported(),
    open: () => platform.sidebar.open(),
    /** 以最近一次 onShow 参数判断是否从侧边栏进入 */
    isLaunchedFromSidebar: () => sidebarSimulated || platform.sidebar.isLaunchedFromSidebar(platform.getShowOptions()),
};

/** 调试用：按从侧边栏进入处理，并触发 onSidebarLaunch 回调 */
export function simulateSidebarLaunch() {
    sidebarSimulated = true;
    if (!userSave.hasScope) {
        pendingSidebarListeners = Array.from(new Set(pendingSidebarListeners.concat(sidebarListeners)));
        return;
    }
    for (const listener of sidebarListeners.slice()) {
        try {
            listener();
        } catch (err) {
            reportError(err, 'manual', { from: 'onSidebarLaunch' });
        }
    }
}

const sidebarSlot = userSave.slot('sidebar', { version: 1, defaults: () => ({ lastClaimDay: '' }) });
export const sidebarReward = new SidebarReward({
    store: { get: () => sidebarSlot.get(), set: (value) => sidebarSlot.set(value) },
    launchedFromSidebar: () => sidebar.isLaunchedFromSidebar(),
    ready: () => userSave.hasScope,
    today: () => serverTime.today(),
});

/** 从侧边栏进入（启动或切回前台）时回调；登录完成前进入的，登录后回调。同一次进入可能回调多次，发奖用 sidebarReward.claim() 判重 */
export function onSidebarLaunch(listener: () => void): () => void {
    if (sidebar.isLaunchedFromSidebar()) {
        if (userSave.hasScope) listener();
        else pendingSidebarListeners.push(listener);
    }
    sidebarListeners.push(listener);
    const off = platform.onShow((options) => {
        if (!platform.sidebar.isLaunchedFromSidebar(options)) return;
        if (userSave.hasScope) listener();
        else if (!pendingSidebarListeners.includes(listener)) pendingSidebarListeners.push(listener);
    });
    return () => {
        off();
        sidebarListeners = sidebarListeners.filter((l) => l !== listener);
        pendingSidebarListeners = pendingSidebarListeners.filter((l) => l !== listener);
    };
}

/** 登录完成后执行登录前从侧边栏进入时登记的回调 */
export function flushSidebarListeners() {
    const listeners = pendingSidebarListeners;
    pendingSidebarListeners = [];
    for (const listener of listeners) {
        try {
            listener();
        } catch (err) {
            reportError(err, 'manual', { from: 'onSidebarLaunch' });
        }
    }
}
