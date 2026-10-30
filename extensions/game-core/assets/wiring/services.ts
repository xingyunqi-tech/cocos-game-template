import { sys } from 'cc';
import { DEBUG } from 'cc/env';
import { oops } from 'db://oops-framework/core/Oops';
import { AdPolicy } from '../ads/AdPolicy';
import { AdService } from '../ads/AdService';
import { BootPipeline } from '../boot/BootPipeline';
import { Lifecycle } from '../boot/Lifecycle';
import { HealthNotice } from '../compliance/HealthNotice';
import { assertReleasable, unloadBundle } from '../config/Bundles';
import { RemoteConfig, type RemoteSettingsMap } from '../config/RemoteConfig';
import { createLogger } from '../monitor/logger';
import { track } from '../monitor/track';
import { HttpClient } from '../net/HttpClient';
import { MockTransport } from '../net/MockTransport';
import { XhrTransport } from '../net/XhrTransport';
import { PaymentService } from '../payment/Payment';
import type { PendingOrder } from '../payment/types';
import { AppUpdate } from '../platform/AppUpdate';
import { createPlatform } from '../platform/createPlatform';
import { NetworkStatus } from '../platform/NetworkStatus';
import type { IPlatform, LaunchOptions } from '../platform/types';
import type { KeyValueStore } from '../save/KeyValueStore';
import { SaveStore } from '../save/SaveStore';
import { ServerTime } from '../time/ServerTime';
import { showConfirm, type ConfirmOptions } from '../ui/ConfirmDialog';
import { toDesignInset, type DesignInset } from '../ui/inset';
import { setButtonClickHook, visibleSize } from '../ui/kit';
import { setSafeTopProvider } from '../ui/SafeTopAdapter';
import { Settings } from '../ui/Settings';
import { SoundService, type SoundRef } from '../ui/Sound';

let backingStore: KeyValueStore | null = null;
const storage = () => backingStore ?? (sys.localStorage as KeyValueStore);
const localStore: KeyValueStore = {
    getItem: (key) => storage().getItem(key),
    setItem: (key, value) => storage().setItem(key, value),
    removeItem: (key) => storage().removeItem(key),
};

const log = createLogger('game-core');
const saveWarn = (message: string, detail: Record<string, unknown>) => log.warn(message, detail);

export let platform: IPlatform = createPlatform({ debug: DEBUG });
export const bootPipeline = new BootPipeline();
export const lifecycle = new Lifecycle();
export const xhrTransport = new XhrTransport();
export const mockTransport = new MockTransport();
export const http = new HttpClient({ transport: xhrTransport });
export const serverTime = new ServerTime({ monotonic: () => platform.monotonicNow() });
http.useResponse((response) => {
    if (!response.headers.age) serverTime.syncFromDateHeader(response.headers.date);
    return response;
});
export const payment = new PaymentService((item, result) =>
    track('pay_result', { productId: item.productId, price: item.price, result: result.result, reason: result.reason }),
);
payment.onLateResult((item, result) =>
    track('pay_late_result', {
        productId: item.productId,
        price: item.price,
        orderId: result.orderId,
        result: result.result,
        reason: result.reason,
    }),
);
export const deviceSave = new SaveStore({ store: localStore, prefix: 'gc:d', onWarn: saveWarn });
export const userSave = new SaveStore({ store: localStore, prefix: 'gc:u', requireScope: true, onWarn: saveWarn });
const orderSlot = userSave.slot('pay_orders', { version: 1, defaults: () => ({ orders: [] as PendingOrder[] }) });
payment.setOrderStore({
    load: () => (userSave.hasScope ? orderSlot.get().orders : []),
    save: (orders) => {
        if (!userSave.hasScope) {
            log.warn('未登录，待确认订单未保存', { orders: orders.map((order) => order.orderId) });
            return;
        }
        if (orders.length === 0) orderSlot.reset();
        else orderSlot.set({ orders });
        userSave.flush();
    },
});
export const remoteConfig = new RemoteConfig<RemoteSettingsMap>(
    { reviewMode: false, shareReward: false },
    (key, value) => log.warn('远程配置类型与默认值不一致，已忽略', { key, value }),
);

export const coreOptions = {
    /** 启动时显示健康游戏忠告加载页 */
    healthNotice: true,
    /** 加载页最短展示时间 */
    healthNoticeMinMs: 1500,
    /** 适龄提示文字，null 不显示 */
    ageRating: '8+' as string | null,
    offlineBanner: true,
    offlineBannerText: '网络已断开，请检查网络设置',
    /** false 不弹窗，新版本在下次冷启动时生效 */
    updatePrompt: {
        title: '更新提示',
        content: '新版本已准备好，是否重启应用？',
        confirmText: '重启',
        cancelText: '稍后',
    } as ConfirmOptions | false,
    sidebarEntry: {
        text: '侧边栏',
        /** 须与业务实际发放的奖励一致 */
        rewardText: '从抖音首页侧边栏进入游戏，每天可领取一次奖励',
    },
    settingsTitle: '设置',
    /** 模板按钮的点击音效，null 不播放 */
    clickSound: null as SoundRef | null,
    /** 调试构建显示 GM 按钮 */
    gm: true,
    /** 平台广告展示期间暂停背景音乐，结束后恢复 */
    pauseMusicDuringAds: true,
};

export type ConfirmProvider = (options: ConfirmOptions) => Promise<boolean>;
let confirmProvider: ConfirmProvider = showConfirm;

/** 模板内所有确认框（隐私、更新、侧边栏引导）都经过这里 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
    return confirmProvider(options);
}

export function setConfirmProvider(provider: ConfirmProvider) {
    confirmProvider = provider;
}

export const STORAGE_WARN_RATIO = 0.8;
export const LOGIN_STEP_TIMEOUT_MS = 30000;

export const network = new NetworkStatus();
export const appUpdate = new AppUpdate();
function adClock(): () => number {
    let last = platform.monotonicNow();
    if (last === null) return Date.now;
    return () => (last = platform.monotonicNow() ?? last ?? 0);
}

export const ads = new AdService({
    policy: new AdPolicy({}, adClock()),
    onShowingChange: (showing) => {
        if (!showing) sound.resumeAfterAd();
        else if (coreOptions.pauseMusicDuringAds) sound.pauseForAd();
    },
    onResult: (kind, placement, outcome) =>
        track('ad_result', {
            kind,
            placement,
            result: outcome.result,
            reason: outcome.reason,
            errCode: outcome.errCode,
        }),
});
ads.onLateResult((kind, placement, outcome) =>
    track('ad_late_result', { kind, placement, result: outcome.result, reason: outcome.reason }),
);
ads.setProvider(platform.ads);

type ShowListener = (options: LaunchOptions) => void;
const showSubscriptions = new Map<ShowListener, () => void>();

/** 订阅当前平台的 onShow，替换平台实现后自动转到新平台 */
export function onPlatformShow(listener: ShowListener): () => void {
    showSubscriptions.get(listener)?.();
    showSubscriptions.set(listener, platform.onShow(listener));
    return () => {
        showSubscriptions.get(listener)?.();
        showSubscriptions.delete(listener);
    };
}

/** 替换平台实现，只在 initGameCore 之前调用 */
export function usePlatform(next: IPlatform) {
    platform = next;
    ads.setProvider(next.ads);
    ads.policy.useClock(adClock());
    for (const [listener, off] of Array.from(showSubscriptions)) {
        off();
        showSubscriptions.set(listener, next.onShow(listener));
    }
}

/** 替换 deviceSave、userSave 的存储后端，只在 initGameCore 之前调用；之前的写入先落到原存储 */
export function useStore(store: KeyValueStore) {
    deviceSave.flush();
    userSave.flush();
    backingStore = store;
    deviceSave.reload();
    userSave.reload();
}

const deviceSlot = deviceSave.slot('device', { version: 1, defaults: () => ({ id: '' }) });

export function getDeviceId(): string {
    let id = deviceSlot.get().id;
    if (!id) {
        id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        deviceSlot.set({ id });
        deviceSave.flush();
    }
    return id;
}

export function getDesignInset(): DesignInset {
    return toDesignInset(platform.getTopInset(), platform.getSystemInfo().windowWidth, visibleSize().width);
}
setSafeTopProvider(() => getDesignInset().top);

export const sound = new SoundService();

/** 释放业务 Bundle：停止来自该 Bundle 的背景音乐、丢弃音频缓存，再释放全部资源；未加载时返回 false，引擎内置 Bundle 抛错 */
export function releaseBundle(name: string): boolean {
    assertReleasable(name);
    sound.forgetBundle(name);
    return unloadBundle(name);
}
setButtonClickHook(() => {
    if (coreOptions.clickSound) void sound.playEffect(coreOptions.clickSound);
});

const settingsSlot = deviceSave.slot('settings', { version: 1, defaults: () => ({ vibrate: true }) });
export const settings = new Settings(
    () => {
        const audio = oops.audio;
        if (!audio?.music) return null;
        return {
            getMusic: () => audio.music.getSwitch(),
            setMusic: (on) => {
                const wasOn = audio.music.getSwitch();
                audio.music.setSwitch(on);
                audio.save();
                if (on && !wasOn) void sound.resumeMusic();
            },
            getEffect: () => audio.effect.getSwitch(),
            setEffect: (on) => {
                audio.effect.setSwitch(on);
                audio.save();
            },
        };
    },
    { get: () => settingsSlot.get(), set: (value) => settingsSlot.set(value) },
    (type) => platform.vibrate(type),
);

export const healthNotice = new HealthNotice();

export function checkStorageUsage(ratio = STORAGE_WARN_RATIO): boolean {
    const usage = platform.getStorageUsage();
    if (!usage || usage.limitKB <= 0 || usage.currentKB / usage.limitKB < ratio) return false;
    log.warn('本地存储接近上限', usage);
    track('storage_high', { currentKB: usage.currentKB, limitKB: usage.limitKB });
    return true;
}

export function setSaveUser(userId: string) {
    userSave.setScope(userId);
}
