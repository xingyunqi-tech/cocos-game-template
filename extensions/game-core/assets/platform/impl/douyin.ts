import type {
    EnvVersion,
    ISidebar,
    LaunchOptions,
    PrivacyHandler,
    PrivacySetting,
    ShareOptions,
    ShareResult,
    SystemInfo,
    TopInset,
} from '../types';
import { compareVersion, isSidebarLaunch } from '../utils';
import { invokeApi, MiniGameAdProvider, MiniGamePlatform, toRect, toSystemInfo } from './minigame';
import type { DouyinApi } from './minigame-api';

declare const tt: DouyinApi;

export const DOUYIN_PRIVACY_MIN_SDK = '4.17.0';

const ENV_TYPES: Record<string, EnvVersion> = {
    development: 'develop',
    preview: 'trial',
    production: 'release',
};

export class DouyinSidebar implements ISidebar {
    isSupported(): Promise<boolean> {
        if (typeof tt.checkScene !== 'function') return Promise.resolve(false);
        return invokeApi<{ isExist: boolean }>((cb) => tt.checkScene?.({ ...cb, scene: 'sidebar' })).then(
            (res) => Boolean(res.isExist),
            () => false,
        );
    }

    open(): Promise<boolean> {
        return invokeApi((cb) => tt.navigateToScene({ ...cb, scene: 'sidebar' })).then(
            () => true,
            () => false,
        );
    }

    isLaunchedFromSidebar(options: LaunchOptions): boolean {
        return isSidebarLaunch(options);
    }
}

export class DouyinPlatform extends MiniGamePlatform {
    readonly name = 'douyin' as const;
    readonly ads = new MiniGameAdProvider(tt, { recreateInterstitialAfterShow: true });
    readonly sidebar = new DouyinSidebar();
    private readonly tt: DouyinApi;

    constructor() {
        super(tt);
        this.tt = tt;
    }

    getSystemInfo(): SystemInfo {
        return toSystemInfo(this.safeSystemInfo());
    }

    getTopInset(): TopInset {
        const inset: TopInset = { safeTop: this.safeTopFrom(this.safeSystemInfo()) };
        try {
            const menuRect = toRect(this.tt.getMenuButtonLayout?.());
            if (menuRect) inset.menuRect = menuRect;
        } catch {
            return inset;
        }
        return inset;
    }

    getEnvVersion(): EnvVersion {
        try {
            return ENV_TYPES[this.tt.getEnvInfoSync?.().microapp?.envType ?? ''] ?? 'release';
        } catch {
            return 'release';
        }
    }

    share(options: ShareOptions): Promise<ShareResult> {
        return invokeApi((cb) => this.tt.shareAppMessage({ ...options, ...cb })).then(
            () => 'success' as const,
            () => 'fail' as const,
        );
    }

    getPrivacySetting(): Promise<PrivacySetting> {
        return Promise.resolve({ supported: false, needAuthorization: false });
    }

    openPrivacyContract(): Promise<boolean> {
        return Promise.resolve(false);
    }

    onNeedPrivacyAuthorization(handler: PrivacyHandler): boolean {
        if (typeof this.tt.onNeedPrivacyAuthorization !== 'function') return false;
        if (compareVersion(this.getSystemInfo().sdkVersion, DOUYIN_PRIVACY_MIN_SDK) < 0) return false;
        this.tt.onNeedPrivacyAuthorization((resolve) =>
            handler(
                (agree) => resolve({ event: agree ? 'agree' : 'disagree' }),
                () => undefined,
            ),
        );
        return true;
    }
}
