import type { RawLaunchOptions } from '../utils';

export interface ApiError {
    errMsg?: string;
    errCode?: number;
    errNo?: number;
}

export interface Callbacks<T = unknown> {
    success?: (res: T) => void;
    fail?: (err: ApiError) => void;
}

export interface RawRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface RawSystemInfo {
    platform?: string;
    model?: string;
    system?: string;
    SDKVersion?: string;
    version?: string;
    windowWidth?: number;
    windowHeight?: number;
    pixelRatio?: number;
    statusBarHeight?: number;
    safeArea?: RawRect;
}

export interface NetworkStatusEvent {
    isConnected: boolean;
    networkType: string;
}

export interface UpdateManager {
    onUpdateReady(listener: () => void): void;
    onUpdateFailed?(listener: () => void): void;
    applyUpdate(): void;
}

export interface RewardedVideoAd {
    load(): Promise<unknown>;
    show(): Promise<unknown>;
    onClose(listener: (res?: { isEnded?: boolean }) => void): void;
    offClose(listener: (res?: { isEnded?: boolean }) => void): void;
    onError(listener: (err: ApiError) => void): void;
    offError(listener: (err: ApiError) => void): void;
}

export interface InterstitialAd {
    load(): Promise<unknown>;
    show(): Promise<unknown>;
    onClose(listener: () => void): void;
    offClose(listener: () => void): void;
    onError(listener: (err: ApiError) => void): void;
    offError(listener: (err: ApiError) => void): void;
    destroy(): void;
}

export interface ShareAppMessageOptions extends Callbacks {
    title?: string;
    imageUrl?: string;
    query?: string;
}

export type ErrorListener = (res: { message?: string; stack?: string } | string) => void;
export type RejectionListener = (res: { reason?: unknown }) => void;
export type MemoryListener = (res: { level?: number }) => void;

export interface MiniGameApi {
    login(options: Callbacks<{ code?: string; anonymousCode?: string }> & { force?: boolean }): void;
    checkSession(options: Callbacks): void;
    getLaunchOptionsSync(): RawLaunchOptions;
    onShow(listener: (res: RawLaunchOptions) => void): void;
    offShow?(listener: (res: RawLaunchOptions) => void): void;
    shareAppMessage(options: ShareAppMessageOptions): void;
    showShareMenu?(options: Callbacks & { withShareTicket?: boolean; menus?: string[] }): void;
    onShareAppMessage?(listener: () => ShareAppMessageOptions): void;
    offShareAppMessage?(listener: () => ShareAppMessageOptions): void;
    getSystemInfoSync(): RawSystemInfo;
    getNetworkType(options: Callbacks<{ networkType: string }>): void;
    onNetworkStatusChange(listener: (res: NetworkStatusEvent) => void): void;
    offNetworkStatusChange?(listener: (res: NetworkStatusEvent) => void): void;
    vibrateShort(options: Callbacks & { type?: string }): void;
    vibrateLong(options: Callbacks): void;
    setClipboardData(options: Callbacks & { data: string }): void;
    getUpdateManager?(): UpdateManager;
    onError?(listener: ErrorListener): void;
    offError?(listener: ErrorListener): void;
    onUnhandledRejection?(listener: RejectionListener): void;
    offUnhandledRejection?(listener: RejectionListener): void;
    onMemoryWarning?(listener: MemoryListener): void;
    offMemoryWarning?(listener: MemoryListener): void;
    getStorageInfoSync?(): { currentSize: number; limitSize: number };
    createRewardedVideoAd?(options: { adUnitId: string }): RewardedVideoAd;
    createInterstitialAd?(options: { adUnitId: string }): InterstitialAd;
}

export interface NeedPrivacyResolve {
    (result: { event: 'exposureAuthorization' | 'agree' | 'disagree'; buttonId?: string }): void;
}

export interface WechatApi extends MiniGameApi {
    getWindowInfo?(): RawSystemInfo;
    getDeviceInfo?(): RawSystemInfo;
    getAppBaseInfo?(): RawSystemInfo;
    getMenuButtonBoundingClientRect?(): RawRect;
    getAccountInfoSync?(): { miniProgram?: { envVersion?: string } };
    getPrivacySetting?(options: Callbacks<{ needAuthorization: boolean }>): void;
    openPrivacyContract?(options: Callbacks): void;
    onNeedPrivacyAuthorization?(listener: (resolve: NeedPrivacyResolve) => void): void;
    onShareTimeline?(listener: () => { title?: string; imageUrl?: string; query?: string }): void;
    offShareTimeline?(listener: () => { title?: string; imageUrl?: string; query?: string }): void;
}

export interface DouyinApi extends MiniGameApi {
    getMenuButtonLayout?(): RawRect;
    getEnvInfoSync?(): { microapp?: { envType?: string } };
    checkScene?(options: Callbacks<{ isExist: boolean }> & { scene: string }): void;
    navigateToScene(options: Callbacks & { scene: string }): void;
    onNeedPrivacyAuthorization?(listener: (resolve: NeedPrivacyResolve) => void): void;
}
