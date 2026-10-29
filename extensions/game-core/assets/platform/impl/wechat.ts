import type {
    EnvVersion,
    ISidebar,
    PrivacyHandler,
    PrivacySetting,
    ShareOptions,
    ShareResult,
    SystemInfo,
    TopInset,
} from '../types';
import {
    invokeApi,
    MiniGameAdProvider,
    MiniGamePlatform,
    NoRecorder,
    NoSidebar,
    toRect,
    toSystemInfo,
} from './minigame';
import type { RawSystemInfo, WechatApi } from './minigame-api';

declare const wx: WechatApi;

const ENV_VERSIONS: readonly string[] = ['develop', 'trial', 'release'];

export class WechatPlatform extends MiniGamePlatform {
    readonly name = 'wechat' as const;
    readonly ads = new MiniGameAdProvider(wx, { recreateInterstitialAfterShow: false });
    readonly sidebar: ISidebar = new NoSidebar();
    readonly recorder = new NoRecorder();
    private readonly wx: WechatApi;
    private timelineListener: (() => ShareOptions) | null = null;

    constructor() {
        super(wx);
        this.wx = wx;
    }

    getSystemInfo(): SystemInfo {
        return toSystemInfo(this.rawSystemInfo());
    }

    getTopInset(): TopInset {
        const inset: TopInset = { safeTop: this.safeTopFrom(this.rawWindowInfo()) };
        try {
            const menuRect = toRect(this.wx.getMenuButtonBoundingClientRect?.());
            if (menuRect) inset.menuRect = menuRect;
        } catch {
            return inset;
        }
        return inset;
    }

    getEnvVersion(): EnvVersion {
        try {
            const version = this.wx.getAccountInfoSync?.().miniProgram?.envVersion ?? 'release';
            return ENV_VERSIONS.includes(version) ? (version as EnvVersion) : 'release';
        } catch {
            return 'release';
        }
    }

    share(options: ShareOptions): Promise<ShareResult> {
        try {
            this.wx.shareAppMessage({ ...options });
        } catch {
            return Promise.resolve('fail');
        }
        return Promise.resolve('unknown');
    }

    setShareMenu(options: ShareOptions) {
        super.setShareMenu(options);
        try {
            if (this.timelineListener) this.wx.offShareTimeline?.(this.timelineListener);
            this.timelineListener = () => ({ title: options.title, imageUrl: options.imageUrl, query: options.query });
            this.wx.onShareTimeline?.(this.timelineListener);
        } catch (err) {
            console.warn('[game-core] 设置朋友圈分享失败', err);
        }
    }

    getPrivacySetting(): Promise<PrivacySetting> {
        if (typeof this.wx.getPrivacySetting !== 'function') {
            return Promise.resolve({ supported: false, needAuthorization: false });
        }
        return invokeApi<{ needAuthorization: boolean }>((cb) => this.wx.getPrivacySetting?.(cb)).then(
            (res) => ({ supported: true, needAuthorization: Boolean(res.needAuthorization) }),
            () => ({ supported: true, needAuthorization: true }),
        );
    }

    openPrivacyContract(): Promise<boolean> {
        if (typeof this.wx.openPrivacyContract !== 'function') return Promise.resolve(false);
        return invokeApi((cb) => this.wx.openPrivacyContract?.(cb)).then(
            () => true,
            () => false,
        );
    }

    requirePrivacyAuthorize(): Promise<boolean> {
        if (typeof this.wx.requirePrivacyAuthorize !== 'function') return Promise.resolve(true);
        return invokeApi((cb) => this.wx.requirePrivacyAuthorize?.(cb)).then(
            () => true,
            () => false,
        );
    }

    onNeedPrivacyAuthorization(handler: PrivacyHandler): boolean {
        if (typeof this.wx.onNeedPrivacyAuthorization !== 'function') return false;
        this.wx.onNeedPrivacyAuthorization((resolve) =>
            handler(
                (agree) => resolve({ event: agree ? 'agree' : 'disagree' }),
                () => resolve({ event: 'exposureAuthorization' }),
            ),
        );
        return true;
    }

    private rawWindowInfo(): RawSystemInfo {
        try {
            if (this.wx.getWindowInfo) return this.wx.getWindowInfo();
        } catch {
            return this.safeSystemInfo();
        }
        return this.safeSystemInfo();
    }

    private rawSystemInfo(): RawSystemInfo {
        if (!this.wx.getWindowInfo || !this.wx.getDeviceInfo || !this.wx.getAppBaseInfo) return this.safeSystemInfo();
        try {
            return { ...this.wx.getDeviceInfo(), ...this.wx.getAppBaseInfo(), ...this.wx.getWindowInfo() };
        } catch {
            return this.safeSystemInfo();
        }
    }
}
