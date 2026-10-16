import type { ErrorReporter } from '../../monitor/errors';
import type {
    AdProvider,
    EnvVersion,
    InterstitialResult,
    IPlatform,
    ISidebar,
    LaunchOptions,
    LoginCredential,
    NetworkType,
    PlatformName,
    PrivacyHandler,
    PrivacySetting,
    Rect,
    RewardedResult,
    ShareOptions,
    ShareResult,
    StorageUsage,
    SystemInfo,
    TopInset,
} from '../types';
import { errorCodeOf, normalizeLaunchOptions, toNetworkType, type RawLaunchOptions } from '../utils';
import type {
    ApiError,
    ErrorListener,
    InterstitialAd,
    MemoryListener,
    MiniGameApi,
    NetworkStatusEvent,
    RawRect,
    RawSystemInfo,
    RejectionListener,
    RewardedVideoAd,
    UpdateManager,
} from './minigame-api';

export function toRect(raw: RawRect | undefined | null): Rect | undefined {
    if (!raw || typeof raw.top !== 'number') return undefined;
    return { left: raw.left, top: raw.top, width: raw.width, height: raw.height };
}

export function toSystemInfo(raw: RawSystemInfo): SystemInfo {
    return {
        os: (raw.platform ?? 'unknown').toLowerCase(),
        model: raw.model ?? '',
        system: raw.system ?? '',
        sdkVersion: raw.SDKVersion ?? '',
        hostVersion: raw.version ?? '',
        windowWidth: raw.windowWidth ?? 0,
        windowHeight: raw.windowHeight ?? 0,
        pixelRatio: raw.pixelRatio ?? 1,
        statusBarHeight: raw.statusBarHeight ?? 0,
        safeArea: toRect(raw.safeArea),
    };
}

export function invokeApi<T>(
    invoke: (callbacks: { success: (res: T) => void; fail: (err: ApiError) => void }) => void,
) {
    return new Promise<T>((resolve, reject) => {
        try {
            invoke({ success: resolve, fail: reject });
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}

const noop = () => undefined;

function safely(fn: () => void) {
    try {
        fn();
    } catch (err) {
        console.warn('[game-core] 平台接口调用失败', err);
    }
}

export class NoSidebar implements ISidebar {
    isSupported() {
        return Promise.resolve(false);
    }

    open() {
        return Promise.resolve(false);
    }

    isLaunchedFromSidebar() {
        return false;
    }
}

export interface MiniGameAdOptions {
    recreateInterstitialAfterShow: boolean;
}

interface PresentableAd<C> {
    load(): Promise<unknown>;
    show(): Promise<unknown>;
    onClose(listener: (res?: C) => void): void;
    offClose(listener: (res?: C) => void): void;
    onError(listener: (err: ApiError) => void): void;
    offError(listener: (err: ApiError) => void): void;
}

function present<C, R>(
    ad: PresentableAd<C>,
    closed: (res?: C) => R,
    failed: (err: unknown) => R,
    afterShown?: () => void,
): Promise<R> {
    return new Promise((resolve) => {
        let shown = false;
        let settled = false;
        const finish = (result: R) => {
            if (settled) return;
            settled = true;
            ad.offClose(onClose);
            ad.offError(onError);
            if (shown) afterShown?.();
            resolve(result);
        };
        const onClose = (res?: C) => finish(closed(res));
        const onError = (err: ApiError) => {
            if (shown) finish(failed(err));
        };
        ad.onClose(onClose);
        ad.onError(onError);
        const show = () =>
            ad.show().then(() => {
                shown = true;
            });
        show()
            .catch(() => ad.load().then(show))
            .catch((err: unknown) => finish(failed(err)));
    });
}

export class MiniGameAdProvider implements AdProvider {
    readonly needsUnitId = true;
    private readonly rewarded: Record<string, RewardedVideoAd> = {};
    private readonly interstitial: Record<string, InterstitialAd> = {};

    constructor(
        private readonly api: MiniGameApi,
        private readonly options: MiniGameAdOptions,
    ) {}

    showRewarded(unitId: string): Promise<RewardedResult> {
        if (!this.api.createRewardedVideoAd) return Promise.resolve({ result: 'failed', reason: 'unsupported' });
        let ad: RewardedVideoAd;
        try {
            ad = this.rewarded[unitId] ??= this.api.createRewardedVideoAd({ adUnitId: unitId });
        } catch (err) {
            return Promise.resolve({ result: 'failed', reason: 'load_failed', errCode: errorCodeOf(err) });
        }
        return present<{ isEnded?: boolean }, RewardedResult>(
            ad,
            (res) => ({ result: !res || res.isEnded ? 'completed' : 'skipped' }),
            (err) => ({ result: 'failed', reason: 'show_failed', errCode: errorCodeOf(err) }),
        );
    }

    showInterstitial(unitId: string): Promise<InterstitialResult> {
        if (!this.api.createInterstitialAd) return Promise.resolve({ result: 'failed', reason: 'unsupported' });
        let ad: InterstitialAd;
        try {
            ad = this.interstitial[unitId] ??= this.api.createInterstitialAd({ adUnitId: unitId });
        } catch (err) {
            return Promise.resolve({ result: 'failed', reason: 'load_failed', errCode: errorCodeOf(err) });
        }
        return present<never, InterstitialResult>(
            ad,
            () => ({ result: 'shown' }),
            (err) => ({ result: 'failed', reason: 'show_failed', errCode: errorCodeOf(err) }),
            () => {
                if (!this.options.recreateInterstitialAfterShow) return;
                delete this.interstitial[unitId];
                safely(() => ad.destroy());
            },
        );
    }
}

export abstract class MiniGamePlatform implements IPlatform {
    abstract readonly name: PlatformName;
    abstract readonly ads: AdProvider;
    abstract readonly sidebar: ISidebar;

    private readonly launchOptions: LaunchOptions;
    private showOptions: LaunchOptions;
    private showListeners: Array<(options: LaunchOptions) => void> = [];
    private updateManager: UpdateManager | null | undefined;
    private updateListeners: Record<'ready' | 'failed', Array<() => void>> = { ready: [], failed: [] };
    private shareListener: (() => ShareOptions) | null = null;

    protected constructor(protected readonly api: MiniGameApi) {
        let raw: RawLaunchOptions | undefined;
        try {
            raw = api.getLaunchOptionsSync();
        } catch {
            raw = undefined;
        }
        this.launchOptions = normalizeLaunchOptions(raw);
        this.showOptions = this.launchOptions;
        api.onShow((res) => {
            this.showOptions = normalizeLaunchOptions(res);
            const options = this.showOptions;
            for (const listener of this.showListeners.slice()) {
                try {
                    listener(options);
                } catch (err) {
                    console.error('[game-core] onShow 回调异常', err);
                }
            }
        });
    }

    abstract getSystemInfo(): SystemInfo;
    abstract getTopInset(): TopInset;
    abstract getEnvVersion(): EnvVersion;
    abstract share(options: ShareOptions): Promise<ShareResult>;
    abstract getPrivacySetting(): Promise<PrivacySetting>;
    abstract openPrivacyContract(): Promise<boolean>;
    abstract onNeedPrivacyAuthorization(handler: PrivacyHandler): boolean;

    login(): Promise<LoginCredential> {
        return invokeApi<{ code?: string; anonymousCode?: string }>((cb) =>
            this.api.login({ ...cb, force: false }),
        ).then((res) => {
            const credential: LoginCredential = {};
            if (res.code) credential.code = res.code;
            if (res.anonymousCode) credential.anonymousCode = res.anonymousCode;
            return credential;
        });
    }

    checkSession(): Promise<boolean> {
        return invokeApi((cb) => this.api.checkSession(cb)).then(
            () => true,
            () => false,
        );
    }

    getLaunchOptions(): LaunchOptions {
        return this.launchOptions;
    }

    getShowOptions(): LaunchOptions {
        return this.showOptions;
    }

    onShow(listener: (options: LaunchOptions) => void): () => void {
        this.showListeners.push(listener);
        return () => {
            this.showListeners = this.showListeners.filter((l) => l !== listener);
        };
    }

    setShareMenu(options: ShareOptions) {
        try {
            if (this.shareListener) this.api.offShareAppMessage?.(this.shareListener);
            this.shareListener = () => ({ ...options });
            this.api.showShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'], fail: noop });
            this.api.onShareAppMessage?.(this.shareListener);
        } catch (err) {
            console.warn('[game-core] 设置分享菜单失败', err);
        }
    }

    getNetworkType(): Promise<NetworkType> {
        return invokeApi<{ networkType: string }>((cb) => this.api.getNetworkType(cb)).then(
            (res) => toNetworkType(res.networkType),
            () => 'unknown' as const,
        );
    }

    onNetworkChange(listener: (online: boolean, type: NetworkType) => void): () => void {
        const handler = (res: NetworkStatusEvent) => listener(res.isConnected, toNetworkType(res.networkType));
        this.api.onNetworkStatusChange(handler);
        return () => this.api.offNetworkStatusChange?.(handler);
    }

    vibrate(type: 'short' | 'long') {
        safely(() => {
            if (type === 'long') this.api.vibrateLong({ fail: noop });
            else this.api.vibrateShort({ type: 'medium', fail: noop });
        });
    }

    setClipboard(text: string): Promise<boolean> {
        return invokeApi((cb) => this.api.setClipboardData({ ...cb, data: text })).then(
            () => true,
            () => false,
        );
    }

    onUpdateReady(listener: () => void): () => void {
        return this.addUpdateListener('ready', listener);
    }

    onUpdateFailed(listener: () => void): () => void {
        return this.addUpdateListener('failed', listener);
    }

    applyUpdate() {
        this.getUpdateManager()?.applyUpdate();
    }

    installErrorHooks(reporter: ErrorReporter): () => void {
        const onError: ErrorListener = (res) => {
            if (typeof res === 'string') reporter.report(res, 'global');
            else reporter.report(Object.assign(new Error(res.message ?? '未知错误'), { stack: res.stack }), 'global');
        };
        const onRejection: RejectionListener = (res) => reporter.report(res.reason, 'promise');
        const onMemory: MemoryListener = (res) => reporter.report('内存告警', 'memory', { level: res.level });
        this.api.onError?.(onError);
        this.api.onUnhandledRejection?.(onRejection);
        this.api.onMemoryWarning?.(onMemory);
        return () => {
            this.api.offError?.(onError);
            this.api.offUnhandledRejection?.(onRejection);
            this.api.offMemoryWarning?.(onMemory);
        };
    }

    getStorageUsage(): StorageUsage | null {
        try {
            const info = this.api.getStorageInfoSync?.();
            if (!info) return null;
            return { currentKB: info.currentSize, limitKB: info.limitSize };
        } catch {
            return null;
        }
    }

    protected safeSystemInfo(): RawSystemInfo {
        try {
            return this.api.getSystemInfoSync();
        } catch {
            return {};
        }
    }

    protected safeTopFrom(info: RawSystemInfo): number {
        return Math.max(info.safeArea?.top ?? 0, info.statusBarHeight ?? 0);
    }

    private addUpdateListener(kind: 'ready' | 'failed', listener: () => void): () => void {
        const manager = this.getUpdateManager();
        if (!manager) return noop;
        this.updateListeners[kind].push(listener);
        return () => {
            this.updateListeners[kind] = this.updateListeners[kind].filter((l) => l !== listener);
        };
    }

    private getUpdateManager(): UpdateManager | null {
        if (this.updateManager === undefined) {
            try {
                this.updateManager = this.api.getUpdateManager?.() ?? null;
            } catch {
                this.updateManager = null;
            }
            const dispatch = (kind: 'ready' | 'failed') => () => {
                for (const listener of this.updateListeners[kind].slice()) safely(listener);
            };
            this.updateManager?.onUpdateReady(dispatch('ready'));
            this.updateManager?.onUpdateFailed?.(dispatch('failed'));
        }
        return this.updateManager;
    }
}
