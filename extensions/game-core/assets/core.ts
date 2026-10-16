import { sys } from 'cc';
import { DEBUG, HTML5 } from 'cc/env';
import { EventMessage } from 'db://oops-framework/core/common/event/EventMessage';
import { oops } from 'db://oops-framework/core/Oops';
import { BootPipeline } from './boot/BootPipeline';
import { Lifecycle } from './boot/Lifecycle';
import { getEnv } from './config/env';
import { RemoteConfig } from './config/RemoteConfig';
import { AdService } from './ads/AdService';
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
        log.info(online ? '网络已恢复' : '网络已断开', type);
        track('network_change', { online, type });
        if (online && auth.userId && !auth.session) void auth.reconnect();
    });
    void network.start(platform);
    appUpdate.bind(platform);
    appUpdate.onReady(() => log.info('新版本已下载，等待应用'));
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
            HttpClient,
            XhrTransport,
        };
    }
}

export function setSaveUser(userId: string) {
    userSave.setScope(userId);
}
