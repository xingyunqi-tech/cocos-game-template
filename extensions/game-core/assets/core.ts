import { AudioSource, sys } from 'cc';
import { DEBUG, HTML5 } from 'cc/env';
import { EventMessage } from 'db://oops-framework/core/common/event/EventMessage';
import { oops } from 'db://oops-framework/core/Oops';
import { BootPipeline } from './boot/BootPipeline';
import { Lifecycle } from './boot/Lifecycle';
import { getEnv } from './config/env';
import { RemoteConfig } from './config/RemoteConfig';
import { AdService } from './ads/AdService';
import { HealthNotice } from './compliance/HealthNotice';
import { PrivacyFlow, type PrivacyPrompt } from './compliance/PrivacyFlow';
import { SidebarReward } from './compliance/SidebarReward';
import { errorReporter, reportError } from './monitor/errors';
import { createLogger, logHub } from './monitor/logger';
import { track, tracker } from './monitor/track';
import { AuthService } from './net/AuthService';
import { HttpClient } from './net/HttpClient';
import { MockTransport } from './net/MockTransport';
import { XhrTransport } from './net/XhrTransport';
import type { KeyValueStore } from './save/KeyValueStore';
import { AppUpdate } from './platform/AppUpdate';
import { createPlatform } from './platform/createPlatform';
import { NetworkStatus } from './platform/NetworkStatus';
import type { IPlatform } from './platform/types';
import { SaveStore } from './save/SaveStore';
import { showConfirm, type ConfirmOptions } from './ui/ConfirmDialog';
import { openDocument, type LegalDocument } from './ui/DocumentPage';
import { toDesignInset, type DesignInset } from './ui/inset';
import { visibleSize } from './ui/kit';
import { OfflineBanner } from './ui/OfflineBanner';
import { setSafeTopProvider } from './ui/SafeTopAdapter';
import { Settings } from './ui/Settings';
import { openSettings } from './ui/SettingsPanel';
import { createSidebarEntry } from './ui/SidebarEntry';

export interface CoreRemoteSettings {
    reviewMode: boolean;
    shareReward: boolean;
}

const storage = () => sys.localStorage as KeyValueStore;
const localStore: KeyValueStore = {
    getItem: (key) => storage().getItem(key),
    setItem: (key, value) => storage().setItem(key, value),
    removeItem: (key) => storage().removeItem(key),
};

const log = createLogger('game-core');
const saveWarn = (message: string, detail: Record<string, unknown>) => log.warn(message, detail);

export const bootPipeline = new BootPipeline();
export const lifecycle = new Lifecycle();
export const xhrTransport = new XhrTransport();
export const mockTransport = new MockTransport();
export const http = new HttpClient({ transport: xhrTransport });
export const deviceSave = new SaveStore({ store: localStore, prefix: 'gc:d', onWarn: saveWarn });
export const userSave = new SaveStore({ store: localStore, prefix: 'gc:u', requireScope: true, onWarn: saveWarn });
export const remoteConfig = new RemoteConfig<CoreRemoteSettings>({ reviewMode: false, shareReward: false });

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
};

export type ConfirmProvider = (options: ConfirmOptions) => Promise<boolean>;
let confirmProvider: ConfirmProvider = showConfirm;

/** 模板内所有确认框（隐私、更新、侧边栏引导）都经过这里 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
    return confirmProvider(options);
}

export const STORAGE_WARN_RATIO = 0.8;
export const LOGIN_STEP_TIMEOUT_MS = 30000;

export const platform: IPlatform = createPlatform({ debug: DEBUG });
export const network = new NetworkStatus();
export const appUpdate = new AppUpdate();
export const ads = new AdService({
    onResult: (kind, placement, outcome) =>
        track('ad_result', {
            kind,
            placement,
            result: outcome.result,
            reason: outcome.reason,
            errCode: outcome.errCode,
        }),
});
ads.setProvider(platform.ads);

export const sidebar = {
    isSupported: () => platform.sidebar.isSupported(),
    open: () => platform.sidebar.open(),
    /** 以最近一次 onShow 参数判断是否从侧边栏进入 */
    isLaunchedFromSidebar: () => platform.sidebar.isLaunchedFromSidebar(platform.getShowOptions()),
};

const deviceSlot = deviceSave.slot('device', { version: 1, defaults: () => ({ id: '' }) });
const authSlot = deviceSave.slot('auth', { version: 1, defaults: () => ({ userId: '' }) });

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

const settingsSlot = deviceSave.slot('settings', { version: 1, defaults: () => ({ vibrate: true }) });
export const settings = new Settings(
    () => {
        const audio = oops.audio;
        if (!audio?.music) return null;
        return {
            getMusic: () => audio.music.getSwitch(),
            setMusic: (on) => {
                audio.music.setSwitch(on);
                audio.save();
                const source = audio.music.getComponent(AudioSource);
                if (on && source?.clip && !source.playing) source.play();
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

export const privacy = new PrivacyFlow({
    platform: () => platform,
    fallbackContract: () => void openLegal('privacy'),
    onDecision: (agree) => track('privacy_decision', { agree }),
});

const sidebarSlot = userSave.slot('sidebar', { version: 1, defaults: () => ({ lastClaimDay: '' }) });
export const sidebarReward = new SidebarReward({
    store: { get: () => sidebarSlot.get(), set: (value) => sidebarSlot.set(value) },
    launchedFromSidebar: () => sidebar.isLaunchedFromSidebar(),
    ready: () => userSave.hasScope,
});

let pendingSidebarListeners: Array<() => void> = [];

/** 从侧边栏进入（启动或切回前台）时回调；登录完成前进入的，登录后回调。同一次进入可能回调多次，发奖用 sidebarReward.claim() 判重 */
export function onSidebarLaunch(listener: () => void): () => void {
    if (sidebar.isLaunchedFromSidebar()) {
        if (userSave.hasScope) listener();
        else pendingSidebarListeners.push(listener);
    }
    const off = platform.onShow((options) => {
        if (userSave.hasScope && platform.sidebar.isLaunchedFromSidebar(options)) listener();
    });
    return () => {
        off();
        pendingSidebarListeners = pendingSidebarListeners.filter((l) => l !== listener);
    };
}

function flushSidebarListeners() {
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

export const healthNotice = new HealthNotice();
const offlineBanner = new OfflineBanner({ top: () => getDesignInset().top, text: () => coreOptions.offlineBannerText });

function openLegal(kind: LegalDocument) {
    const contract =
        kind === 'privacy' && platform.name === 'wechat'
            ? { text: '查看《小游戏隐私保护指引》', onClick: () => void platform.openPrivacyContract() }
            : null;
    return openDocument(kind, { top: () => getDesignInset().top, extraAction: contract });
}

export interface PrivacyPromptText {
    /** 平台后台填写的指引全称，如《xx小游戏隐私保护指引》 */
    guideName?: string;
    title?: string;
    content?: string;
}

export function createPrivacyPrompt(text: PrivacyPromptText = {}): PrivacyPrompt {
    const guide = text.guideName ?? '《隐私保护指引》';
    return ({ openContract }) =>
        confirm({
            title: text.title ?? '隐私保护提示',
            content: text.content ?? `使用相关功能前，请阅读并同意${guide}。拒绝后不影响基础玩法。`,
            confirmText: '同意',
            cancelText: '拒绝',
            links: [{ text: `查看${guide}`, onClick: openContract }],
        });
}

export const defaultPrivacyPrompt: PrivacyPrompt = createPrivacyPrompt();

export const coreUi = {
    toast: (text: string) => oops.gui.toast(text),
    confirm,
    /** 替换模板内全部确认框的实现，例如改用业务 prefab */
    setConfirm: (provider: ConfirmProvider) => {
        confirmProvider = provider;
    },
    openSettings: () =>
        openSettings({
            title: coreOptions.settingsTitle,
            settings,
            openPrivacy: () => void openLegal('privacy'),
            openAgreement: () => void openLegal('agreement'),
        }),
    openDocument: (kind: LegalDocument) => openLegal(kind),
    createSidebarEntry: (parent: Parameters<typeof createSidebarEntry>[0]) =>
        createSidebarEntry(parent, {
            isSupported: sidebar.isSupported,
            open: sidebar.open,
            confirm,
            text: coreOptions.sidebarEntry.text,
            rewardText: coreOptions.sidebarEntry.rewardText,
        }),
};

export const auth = new AuthService({
    http,
    platform: () => platform,
    deviceId: getDeviceId,
    lastUser: {
        get: () => authSlot.get().userId,
        set: (userId) => {
            if (authSlot.get().userId === userId) return;
            authSlot.set({ userId });
            deviceSave.flush();
        },
    },
    onUser: (userId) => setSaveUser(userId),
    onWarn: (message, detail) => log.warn(message, detail),
});

bootPipeline.register(
    'login',
    async ({ signal }) => {
        const outcome = await auth.login(signal);
        log.info(outcome.offline ? '离线进入' : '登录成功');
        log.debug('userId', outcome.userId);
        track('login', { offline: outcome.offline });
        flushSidebarListeners();
    },
    { timeoutMs: LOGIN_STEP_TIMEOUT_MS },
);

bootPipeline.register(
    'remote-config',
    async () => {
        const source = await remoteConfig.load();
        log.info('远程配置来源', source);
    },
    { optional: true, timeoutMs: 5000 },
);

export function checkStorageUsage(ratio = STORAGE_WARN_RATIO): boolean {
    const usage = platform.getStorageUsage();
    if (!usage || usage.limitKB <= 0 || usage.currentKB / usage.limitKB < ratio) return false;
    log.warn('本地存储接近上限', usage);
    track('storage_high', { currentKB: usage.currentKB, limitKB: usage.limitKB });
    return true;
}

function registerAuthMock() {
    mockTransport.on('POST', '/auth/login', ({ body }) => {
        const { deviceId, anonymousCode } = (body ?? {}) as { deviceId?: string; anonymousCode?: string };
        const id = (deviceId ?? anonymousCode ?? 'guest').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        return {
            body: {
                token: `mock-token-${id}`,
                refreshToken: `mock-refresh-${id}`,
                userId: `mock-${id}`,
                expiresIn: 7200,
            },
        };
    });
    mockTransport.on('POST', '/auth/refresh', ({ body }) => {
        const { refreshToken = '' } = (body ?? {}) as { refreshToken?: string };
        if (!refreshToken.startsWith('mock-refresh-')) return { status: 401 };
        return { body: { token: `mock-token-${refreshToken.slice(13)}-${Date.now()}`, expiresIn: 7200 } };
    });
}

let initialized = false;

export function initGameCore() {
    if (initialized) return;
    initialized = true;

    const env = getEnv();
    logHub.setLevel(env.logLevel ?? (DEBUG ? 'debug' : 'warn'));
    errorReporter.addSink((report) => log.error(`[${report.source}] ${report.message}`, report.context));
    platform.installErrorHooks(errorReporter);
    const context = { version: env.version, platform: platform.name, envVersion: platform.getEnvVersion() };
    errorReporter.setContext(context);
    tracker.setCommonParams(context);
    tracker.addSink(({ event, params }) => log.debug('track', event, params));

    http.configure({
        baseUrl: env.httpServer,
        timeoutMs: env.httpTimeout,
        transport: env.httpMock ? mockTransport : xhrTransport,
        tokenProvider: auth,
        onError: (error, request) => {
            if (error.kind === 'aborted') return;
            reportError(error, 'http', {
                method: request.method,
                url: request.url,
                kind: error.kind,
                status: error.status,
            });
        },
    });

    auth.configure({ fallback: env.loginFallback ?? 'guest' });
    if (env.httpMock) registerAuthMock();

    lifecycle.bind(oops.message, EventMessage.GAME_SHOW, EventMessage.GAME_HIDE);
    lifecycle.onHide(() => {
        deviceSave.flush();
        userSave.flush();
        checkStorageUsage();
    });
    checkStorageUsage();

    network.onChange((online, type) => {
        if (coreOptions.offlineBanner) offlineBanner.update(online);
        log.info(online ? '网络已恢复' : '网络已断开', type);
        track('network_change', { online, type });
        if (online && auth.userId && !auth.session) void auth.reconnect();
    });
    void network.start(platform).then(() => {
        if (coreOptions.offlineBanner) offlineBanner.update(network.online);
    });
    appUpdate.bind(platform);
    appUpdate.onReady(() => {
        log.info('新版本已下载，等待应用');
        if (!coreOptions.updatePrompt) return;
        void confirm(coreOptions.updatePrompt).then((ok) => ok && appUpdate.apply());
    });
    appUpdate.onFailed(() => reportError('新版本下载失败', 'manual'));

    if (DEBUG && HTML5) {
        (window as unknown as Record<string, unknown>).gameCore = {
            bootPipeline,
            lifecycle,
            http,
            mockTransport,
            deviceSave,
            userSave,
            remoteConfig,
            platform,
            ads,
            auth,
            sidebar,
            network,
            appUpdate,
            settings,
            privacy,
            sidebarReward,
            healthNotice,
            coreUi,
            defaultPrivacyPrompt,
            getDesignInset,
            HttpClient,
            XhrTransport,
        };
    }
}

export function setSaveUser(userId: string) {
    userSave.setScope(userId);
}
