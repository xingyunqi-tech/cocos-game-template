import { SidebarReward } from '../compliance/SidebarReward';
import { reportError } from '../monitor/errors';
import { isUserReady, onUserReady } from './auth';
import { onPlatformShow, platform, serverTime, userSave } from './services';

let sidebarSimulated = false;
let sidebarListeners: Array<() => void> = [];
let pendingSidebarListeners: Array<() => void> = [];

function callSidebarListener(listener: () => void) {
    try {
        listener();
    } catch (err) {
        reportError(err, 'manual', { from: 'onSidebarLaunch' });
    }
}

export const sidebar = {
    isSupported: () => platform.sidebar.isSupported(),
    open: () => platform.sidebar.open(),
    /** 以最近一次 onShow 参数判断是否从侧边栏进入 */
    isLaunchedFromSidebar: () => sidebarSimulated || platform.sidebar.isLaunchedFromSidebar(platform.getShowOptions()),
};

/** 调试用：按从侧边栏进入处理，并触发 onSidebarLaunch 回调 */
export function simulateSidebarLaunch() {
    sidebarSimulated = true;
    if (!isUserReady()) {
        pendingSidebarListeners = Array.from(new Set(pendingSidebarListeners.concat(sidebarListeners)));
        return;
    }
    for (const listener of sidebarListeners.slice()) callSidebarListener(listener);
}

const sidebarSlot = userSave.slot('sidebar', { version: 1, defaults: () => ({ lastClaimDay: '' }) });
export const sidebarReward = new SidebarReward({
    store: { get: () => sidebarSlot.get(), set: (value) => sidebarSlot.set(value) },
    launchedFromSidebar: () => sidebar.isLaunchedFromSidebar(),
    ready: isUserReady,
    today: () => serverTime.today(),
});

/** 从侧边栏进入（启动或切回前台）时回调；登录完成前进入的，登录后回调。同一次进入可能回调多次，发奖用 sidebarReward.claim() 判重 */
export function onSidebarLaunch(listener: () => void): () => void {
    if (sidebar.isLaunchedFromSidebar()) {
        if (isUserReady()) callSidebarListener(listener);
        else pendingSidebarListeners.push(listener);
    }
    sidebarListeners.push(listener);
    const off = onPlatformShow((options) => {
        if (!platform.sidebar.isLaunchedFromSidebar(options)) return;
        if (isUserReady()) callSidebarListener(listener);
        else if (!pendingSidebarListeners.includes(listener)) pendingSidebarListeners.push(listener);
    });
    return () => {
        off();
        sidebarListeners = sidebarListeners.filter((l) => l !== listener);
        pendingSidebarListeners = pendingSidebarListeners.filter((l) => l !== listener);
    };
}

function flushSidebarListeners() {
    const listeners = pendingSidebarListeners;
    pendingSidebarListeners = [];
    for (const listener of listeners) callSidebarListener(listener);
}

onUserReady(() => flushSidebarListeners());
