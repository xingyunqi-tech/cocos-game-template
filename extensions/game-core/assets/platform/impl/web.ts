import { installWebErrorHooks, type ErrorReporter } from '../../monitor/errors';
import type {
    AdProvider,
    EnvVersion,
    InterstitialResult,
    IPlatform,
    ISidebar,
    LaunchOptions,
    LoginCredential,
    NetworkType,
    PrivacySetting,
    RewardedResult,
    ShareOptions,
    ShareResult,
    StorageUsage,
    SystemInfo,
    TopInset,
} from '../types';
import { parseQueryString } from '../utils';
import { NoRecorder, NoSidebar } from './minigame';

export interface WebHost {
    location?: { search?: string; href?: string };
    navigator?: {
        onLine?: boolean;
        userAgent?: string;
        share?: (data: { title?: string; url?: string }) => Promise<void>;
        vibrate?: (pattern: number) => boolean;
        clipboard?: { writeText(text: string): Promise<void> };
    };
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
    addEventListener(type: string, listener: (event: unknown) => void, options?: { capture?: boolean }): void;
    removeEventListener(type: string, listener: (event: unknown) => void, options?: { capture?: boolean }): void;
}

export type WebAdMode = 'completed' | 'skipped' | 'failed';

export class WebAdProvider implements AdProvider {
    readonly needsUnitId = false;

    constructor(public mode: WebAdMode) {}

    showRewarded(): Promise<RewardedResult> {
        if (this.mode === 'failed') return Promise.resolve({ result: 'failed', reason: 'unsupported' });
        return Promise.resolve({ result: this.mode });
    }

    showInterstitial(): Promise<InterstitialResult> {
        if (this.mode === 'failed') return Promise.resolve({ result: 'failed', reason: 'unsupported' });
        return Promise.resolve({ result: 'shown' });
    }
}

export interface WebPlatformOptions {
    debug: boolean;
}

export class WebPlatform implements IPlatform {
    readonly name = 'web' as const;
    readonly ads: WebAdProvider;
    readonly sidebar: ISidebar = new NoSidebar();
    readonly recorder = new NoRecorder();
    private readonly launchOptions: LaunchOptions;

    constructor(
        private readonly host: WebHost,
        private readonly options: WebPlatformOptions,
    ) {
        this.ads = new WebAdProvider(options.debug ? 'completed' : 'failed');
        this.launchOptions = { scene: '', query: parseQueryString(host.location?.search ?? '') };
    }

    login(): Promise<LoginCredential> {
        return Promise.resolve({});
    }

    checkSession(): Promise<boolean> {
        return Promise.resolve(true);
    }

    getLaunchOptions(): LaunchOptions {
        return this.launchOptions;
    }

    getShowOptions(): LaunchOptions {
        return this.launchOptions;
    }

    onShow(): () => void {
        return () => undefined;
    }

    share(options: ShareOptions): Promise<ShareResult> {
        const share = this.host.navigator?.share;
        if (typeof share !== 'function') return Promise.resolve('fail');
        const href = this.host.location?.href ?? '';
        const url = options.query ? `${href.split('?')[0]}?${options.query}` : href;
        try {
            return share.call(this.host.navigator, { title: options.title, url }).then(
                () => 'success' as const,
                () => 'fail' as const,
            );
        } catch {
            return Promise.resolve('fail');
        }
    }

    setShareMenu() {
        return;
    }

    getSystemInfo(): SystemInfo {
        return {
            os: 'web',
            model: '',
            system: this.host.navigator?.userAgent ?? '',
            sdkVersion: '',
            hostVersion: '',
            windowWidth: this.host.innerWidth ?? 0,
            windowHeight: this.host.innerHeight ?? 0,
            pixelRatio: this.host.devicePixelRatio ?? 1,
            statusBarHeight: 0,
        };
    }

    getTopInset(): TopInset {
        return { safeTop: 0 };
    }

    getNetworkType(): Promise<NetworkType> {
        return Promise.resolve(this.host.navigator?.onLine === false ? 'none' : 'unknown');
    }

    onNetworkChange(listener: (online: boolean, type: NetworkType) => void): () => void {
        const online = () => listener(true, 'unknown');
        const offline = () => listener(false, 'none');
        this.host.addEventListener('online', online);
        this.host.addEventListener('offline', offline);
        return () => {
            this.host.removeEventListener('online', online);
            this.host.removeEventListener('offline', offline);
        };
    }

    vibrate(type: 'short' | 'long') {
        try {
            this.host.navigator?.vibrate?.(type === 'long' ? 400 : 15);
        } catch {
            return;
        }
    }

    setClipboard(text: string): Promise<boolean> {
        const clipboard = this.host.navigator?.clipboard;
        if (!clipboard) return Promise.resolve(false);
        return clipboard.writeText(text).then(
            () => true,
            () => false,
        );
    }

    getPrivacySetting(): Promise<PrivacySetting> {
        return Promise.resolve({ supported: false, needAuthorization: false });
    }

    openPrivacyContract(): Promise<boolean> {
        return Promise.resolve(false);
    }

    onNeedPrivacyAuthorization(): boolean {
        return false;
    }

    onUpdateReady(): () => void {
        return () => undefined;
    }

    onUpdateFailed(): () => void {
        return () => undefined;
    }

    applyUpdate() {
        return;
    }

    installErrorHooks(reporter: ErrorReporter): () => void {
        return installWebErrorHooks(this.host, reporter);
    }

    getEnvVersion(): EnvVersion {
        return this.options.debug ? 'develop' : 'release';
    }

    getStorageUsage(): StorageUsage | null {
        return null;
    }
}
