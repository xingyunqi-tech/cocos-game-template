import type { ErrorReporter } from '../monitor/errors';

export type PlatformName = 'web' | 'wechat' | 'douyin';

export type EnvVersion = 'develop' | 'trial' | 'release';

export type NetworkType = 'wifi' | '2g' | '3g' | '4g' | '5g' | 'unknown' | 'none';

export type ShareResult = 'success' | 'fail' | 'unknown';

export interface LaunchOptions {
    scene: string;
    query: Record<string, string>;
    launchFrom?: string;
    location?: string;
    referrerInfo?: { appId?: string; extraData?: unknown };
}

export interface ShareOptions {
    title?: string;
    imageUrl?: string;
    query?: string;
}

/** 坐标与尺寸单位均为窗口逻辑像素（与 windowWidth 相同） */
export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface SystemInfo {
    os: string;
    model: string;
    system: string;
    sdkVersion: string;
    hostVersion: string;
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    statusBarHeight: number;
    safeArea?: Rect;
}

export interface TopInset {
    safeTop: number;
    menuRect?: Rect;
}

export interface LoginCredential {
    code?: string;
    anonymousCode?: string;
}

export interface PrivacySetting {
    supported: boolean;
    needAuthorization: boolean;
}

/** 自定义隐私弹窗展示时调用 exposed()，用户选择后调用 resolve() */
export type PrivacyHandler = (resolve: (agree: boolean) => void, exposed: () => void) => void;

export interface StorageUsage {
    currentKB: number;
    limitKB: number;
}

export type AdFailReason = 'unsupported' | 'not_configured' | 'busy' | 'frequency' | 'load_failed' | 'show_failed';

export interface RewardedResult {
    result: 'completed' | 'skipped' | 'failed';
    reason?: AdFailReason;
    errCode?: number;
}

export interface InterstitialResult {
    result: 'shown' | 'failed';
    reason?: AdFailReason;
    errCode?: number;
}

export interface AdProvider {
    readonly needsUnitId: boolean;
    showRewarded(unitId: string): Promise<RewardedResult>;
    showInterstitial(unitId: string): Promise<InterstitialResult>;
}

export interface ISidebar {
    isSupported(): Promise<boolean>;
    open(): Promise<boolean>;
    isLaunchedFromSidebar(options: LaunchOptions): boolean;
}

export interface IPlatform {
    readonly name: PlatformName;
    readonly ads: AdProvider;
    readonly sidebar: ISidebar;
    login(): Promise<LoginCredential>;
    checkSession(): Promise<boolean>;
    getLaunchOptions(): LaunchOptions;
    /** 最近一次 onShow 的参数，未触发过时等于启动参数 */
    getShowOptions(): LaunchOptions;
    onShow(listener: (options: LaunchOptions) => void): () => void;
    /** 需在触摸回调中同步调用 */
    share(options: ShareOptions): Promise<ShareResult>;
    setShareMenu(options: ShareOptions): void;
    getSystemInfo(): SystemInfo;
    getTopInset(): TopInset;
    getNetworkType(): Promise<NetworkType>;
    onNetworkChange(listener: (online: boolean, type: NetworkType) => void): () => void;
    vibrate(type: 'short' | 'long'): void;
    setClipboard(text: string): Promise<boolean>;
    getPrivacySetting(): Promise<PrivacySetting>;
    openPrivacyContract(): Promise<boolean>;
    /** 返回 false 表示当前平台或基础库不支持，隐私弹窗由平台处理 */
    onNeedPrivacyAuthorization(handler: PrivacyHandler): boolean;
    onUpdateReady(listener: () => void): () => void;
    onUpdateFailed(listener: () => void): () => void;
    applyUpdate(): void;
    installErrorHooks(reporter: ErrorReporter): () => void;
    getEnvVersion(): EnvVersion;
    getStorageUsage(): StorageUsage | null;
}
