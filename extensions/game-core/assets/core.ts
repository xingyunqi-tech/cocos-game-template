import { JsonAsset, resources } from 'cc';
import { DEBUG, HTML5, MINIGAME } from 'cc/env';
import { EventMessage } from 'db://oops-framework/core/common/event/EventMessage';
import { oops } from 'db://oops-framework/core/Oops';
import type { IConfigEnvironment } from 'db://oops-framework/module/config/GameConfig';
import { gameConfigData, getEnv } from './config/env';
import { Tables } from './config/Tables';
import { installGmButton } from './debug/GmPanel';
import { errorReporter, ErrorThrottle, reportError } from './monitor/errors';
import { createLogger, logHub } from './monitor/logger';
import { track, tracker } from './monitor/track';
import { isPermanentUploadError, TrackUploader, type UploadRecord } from './monitor/TrackUploader';
import { HttpClient } from './net/HttpClient';
import type { HttpTransport } from './net/types';
import { XhrTransport } from './net/XhrTransport';
import type { IPlatform } from './platform/types';
import type { KeyValueStore } from './save/KeyValueStore';
import { utf8Bytes } from './save/SaveStore';
import { auth, registerLoginStep } from './wiring/auth';
import { registerCoreMocks } from './wiring/mocks';
import { registerRemoteConfigStep } from './wiring/remote';
import {
    ads,
    appUpdate,
    bootPipeline,
    checkStorageUsage,
    confirm,
    coreOptions,
    deviceSave,
    getDesignInset,
    healthNotice,
    http,
    lifecycle,
    mockTransport,
    network,
    payment,
    platform,
    remoteConfig,
    serverTime,
    settings,
    sound,
    usePlatform,
    useStore,
    userSave,
    xhrTransport,
} from './wiring/services';
import { sidebar, sidebarReward, simulateSidebarLaunch } from './wiring/sidebar';
import { coreUi, defaultPrivacyPrompt, offlineBanner, privacy } from './wiring/ui';

export * from './wiring/services';
export { auth, onUserReady } from './wiring/auth';
export { createDailyCounter, createDailyFlags, createLoginStreak, createWallet } from './wiring/daily';
export type { WalletOptions } from './wiring/daily';
export { fetchRemoteConfig } from './wiring/remote';
export { onSidebarLaunch, sidebar, sidebarReward, simulateSidebarLaunch } from './wiring/sidebar';
export { coreUi, createPrivacyPrompt, defaultPrivacyPrompt, privacy } from './wiring/ui';
export type { DocumentProvider, PrivacyPromptText, SettingsProvider } from './wiring/ui';
export { coreText } from './ui/strings';

const log = createLogger('game-core');

export const TABLES_DIR = 'tables';
/** 切后台时最多保存的未上报埋点条数与字节数，超出时保留最新的 */
export const TRACK_PERSIST_MAX = 200;
export const TRACK_PERSIST_MAX_BYTES = 100 * 1024;

registerLoginStep();
bootPipeline.register(
    'tables',
    () =>
        new Promise<void>((resolve, reject) => {
            resources.loadDir(TABLES_DIR, JsonAsset, (err, assets) => {
                if (err) {
                    reject(err);
                    return;
                }
                for (const asset of assets) Tables.set(asset.name, asset.json as Record<string, unknown>);
                log.info('配置表', Tables.names.join(', ') || '无');
                resolve();
            });
        }),
    { before: 'login', timeoutMs: 10000 },
);
registerRemoteConfigStep();

const gmSlot = deviceSave.slot('gm', { version: 1, defaults: () => ({ env: '' }) });

/** 调试用：下次启动使用指定环境（dev / test / prod），空字符串恢复 config.json 的 type */
export function setEnvOverride(type: string) {
    gmSlot.set({ env: type });
    deviceSave.flush();
}

export type GameEntry = () => void | Promise<void>;
let gameEntry: GameEntry | null = null;

/** 注册业务入口，启动流水线完成后调用；抛错时显示启动失败，点击后重新调用，成功后不再调用 */
export function setGameEntry(entry: GameEntry) {
    gameEntry = entry;
}

/** 返回 false 表示入口抛错 */
export async function runGameEntry(): Promise<boolean> {
    const entry = gameEntry;
    if (!entry) {
        log.info('未注册游戏入口');
        return true;
    }
    try {
        await entry();
    } catch (err) {
        reportError(err, 'boot', { step: 'game-entry' });
        return false;
    }
    if (gameEntry === entry) gameEntry = null;
    return true;
}

let initialized = false;
let initFailure: Error | null = null;
let customTransport: HttpTransport | null = null;

export interface CoreConfig {
    /** 替换平台实现（新平台或包装内置实现） */
    platform?: IPlatform;
    /** 替换 deviceSave、userSave 的存储后端，默认 sys.localStorage */
    store?: KeyValueStore;
    /** 替换 HTTP 传输层，设置后忽略 httpMock */
    transport?: HttpTransport;
}

/** 在模块顶层、initGameCore 之前调用 */
export function configureCore(config: CoreConfig) {
    if (initialized) throw new Error('configureCore 须在 initGameCore 之前调用');
    if (config.platform) usePlatform(config.platform);
    if (config.store) useStore(config.store);
    if (config.transport) customTransport = config.transport;
}

/** 配置无效或初始化抛错时抛出；初始化中途失败后再次调用抛出同一错误 */
export function initGameCore() {
    if (initFailure !== null) throw initFailure;
    if (initialized) return;

    const override = DEBUG ? gmSlot.get().env : '';
    if (override && override in gameConfigData().config)
        oops.config.game.setConfigType(override as Parameters<typeof oops.config.game.setConfigType>[0]);
    const env = getEnv();
    if (!env) throw new Error(`config.json 的 type「${gameConfigData().type}」没有对应的环境配置`);
    initialized = true;
    try {
        setupCore(env);
    } catch (err) {
        initFailure = err instanceof Error ? err : new Error(String(err));
        throw initFailure;
    }
}

function setupCore(env: IConfigEnvironment) {
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
        transport: customTransport ?? (env.httpMock ? mockTransport : xhrTransport),
        tokenProvider: auth,
    });
    http.onError((error, request) => {
        if (error.kind === 'aborted' || (env.trackPath && request.url === env.trackPath)) return;
        reportError(error, 'http', {
            method: request.method,
            url: request.url,
            kind: error.kind,
            status: error.status,
        });
    });

    auth.configure({ fallback: env.loginFallback ?? 'guest' });
    if (env.httpMock) registerCoreMocks(mockTransport);
    if (env.trackPath) {
        const path = env.trackPath;
        const queue = deviceSave.slot('track_queue', {
            version: 1,
            defaults: () => ({ records: [] as UploadRecord[] }),
        });
        const uploader = new TrackUploader({
            persist: {
                load: () => queue.get().records,
                save: (records) => {
                    const kept = records.slice(-TRACK_PERSIST_MAX);
                    while (kept.length > 0 && utf8Bytes(JSON.stringify(kept)) > TRACK_PERSIST_MAX_BYTES) kept.shift();
                    if (kept.length === 0) queue.reset();
                    else queue.set({ records: kept });
                    deviceSave.flush();
                },
            },
            send: (records) =>
                http.post(path, { events: records }, { retries: 0, skipRefresh: true }).then(() => undefined),
            isPermanent: isPermanentUploadError,
        });
        tracker.addSink((event) => uploader.push(event));
        const errors = new ErrorThrottle((report) =>
            uploader.push({
                event: 'error',
                params: { ...report.context, source: report.source, message: report.message, stack: report.stack },
                time: report.time,
            }),
        );
        errorReporter.addSink(errors.push);
        lifecycle.onHide(() => {
            errors.flush();
            uploader.persist();
            void uploader.flushAll();
        });
    }

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

    if (DEBUG && coreOptions.gm) {
        installGmButton({
            envTypes: ['dev', 'test', 'prod'],
            currentEnv: () => gmSlot.get().env || gameConfigData().type,
            setEnv: (type) => setEnvOverride(type),
            adSimulation: () => ads.simulate,
            setAdSimulation: (value) => {
                ads.simulate = value;
            },
            paySimulation: () => payment.simulate,
            setPaySimulation: (value) => {
                payment.simulate = value;
            },
            simulateSidebar: () => simulateSidebarLaunch(),
            clearSaves: () => {
                userSave.clearScope();
                deviceSave.clearScope();
            },
            confirm: (content) => confirm({ title: 'GM', content }),
            toast: (text) => oops.gui.toast(text),
            restart: () => {
                if (!HTML5 || MINIGAME) return false;
                deviceSave.flush();
                userSave.flush();
                window.location.reload();
                return true;
            },
        });
    }

    if (DEBUG && HTML5) {
        (window as unknown as Record<string, unknown>).gameCore = {
            bootPipeline,
            lifecycle,
            http,
            mockTransport,
            deviceSave,
            userSave,
            remoteConfig,
            Tables,
            sound,
            serverTime,
            payment,
            simulateSidebarLaunch,
            setEnvOverride,
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
