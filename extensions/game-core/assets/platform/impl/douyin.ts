import type {
    EnvVersion,
    IRecorder,
    ISidebar,
    RecorderOptions,
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
import type { DouyinApi, GameRecorderManager } from './minigame-api';

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

export const RECORDER_MIN_SECONDS = 3;
export const RECORDER_START_TIMEOUT_MS = 3000;
export const RECORDER_STOP_TIMEOUT_MS = 5000;

/** 录满时长自动结束时保存视频，之后调用 stop() 返回该视频 */
export class DouyinRecorder implements IRecorder {
    private manager: GameRecorderManager | null | undefined;
    private startedAt = 0;
    private state: 'idle' | 'starting' | 'recording' = 'idle';
    private lastVideo: string | null = null;
    private pendingStop: ((path: string | null) => void) | null = null;
    private stopping: Promise<string | null> | null = null;
    private ignoreLateStop = false;
    private pendingStart: ((ok: boolean) => void) | null = null;

    constructor(private readonly now: () => number = Date.now) {}

    get supported(): boolean {
        return this.getManager() !== null;
    }

    start(options: RecorderOptions = {}): Promise<boolean> {
        const manager = this.getManager();
        if (!manager || this.state !== 'idle') return Promise.resolve(false);
        this.lastVideo = null;
        this.state = 'starting';
        return new Promise((resolve) => {
            this.pendingStart = resolve;
            setTimeout(() => {
                if (this.pendingStart !== resolve) return;
                this.pendingStart = null;
                this.state = 'idle';
                resolve(false);
            }, RECORDER_START_TIMEOUT_MS);
            try {
                manager.start({ duration: Math.min(300, Math.max(RECORDER_MIN_SECONDS, options.duration ?? 60)) });
            } catch {
                this.pendingStart = null;
                this.state = 'idle';
                resolve(false);
            }
        });
    }

    stop(): Promise<string | null> {
        const manager = this.getManager();
        if (!manager) return Promise.resolve(null);
        if (this.state === 'starting') {
            this.state = 'idle';
            this.pendingStart?.(false);
            this.pendingStart = null;
            return Promise.resolve(null);
        }
        if (this.stopping) return this.stopping;
        this.ignoreLateStop = false;
        if (this.state !== 'recording') {
            const video = this.lastVideo;
            this.lastVideo = null;
            return Promise.resolve(video);
        }
        let resolveStop: (path: string | null) => void = () => undefined;
        const stopping = new Promise<string | null>((resolve) => (resolveStop = resolve));
        this.pendingStop = resolveStop;
        this.stopping = stopping;
        const pending = resolveStop;
        setTimeout(() => {
            if (this.pendingStop !== pending) return;
            this.state = 'idle';
            this.ignoreLateStop = true;
            this.settleStop(null);
        }, RECORDER_STOP_TIMEOUT_MS);
        try {
            manager.stop();
        } catch {
            this.state = 'idle';
            this.settleStop(null);
        }
        return stopping;
    }

    private settleStop(video: string | null) {
        const pending = this.pendingStop;
        this.pendingStop = null;
        this.stopping = null;
        pending?.(video);
    }

    share(videoPath: string, options: ShareOptions & { topics?: string[] } = {}): Promise<ShareResult> {
        const topics = options.topics ?? [];
        return invokeApi((cb) =>
            tt.shareAppMessage({
                ...cb,
                channel: 'video',
                title: options.title,
                query: options.query,
                extra: { videoPath, hashtag_list: topics, videoTopics: topics },
            }),
        ).then(
            () => 'success' as const,
            () => 'fail' as const,
        );
    }

    private getManager(): GameRecorderManager | null {
        if (this.manager !== undefined) return this.manager;
        try {
            this.manager = tt.getGameRecorderManager?.() ?? null;
        } catch {
            this.manager = null;
        }
        const manager = this.manager;
        if (manager) {
            manager.onStart(() => {
                if (this.state !== 'starting') {
                    manager.stop();
                    return;
                }
                this.startedAt = this.now();
                this.state = 'recording';
                this.pendingStart?.(true);
                this.pendingStart = null;
            });
            manager.onStop((res) => {
                if (this.ignoreLateStop) {
                    this.ignoreLateStop = false;
                    return;
                }
                const wasRecording = this.state === 'recording';
                const long = this.now() - this.startedAt >= RECORDER_MIN_SECONDS * 1000;
                const video = wasRecording && long && res?.videoPath ? res.videoPath : null;
                this.state = 'idle';
                if (this.pendingStop) this.settleStop(video);
                else this.lastVideo = video;
            });
            manager.onError(() => {
                this.state = 'idle';
                this.pendingStart?.(false);
                this.pendingStart = null;
                this.settleStop(null);
            });
        }
        return manager;
    }
}

export class DouyinPlatform extends MiniGamePlatform {
    readonly name = 'douyin' as const;
    readonly ads = new MiniGameAdProvider(tt, { recreateInterstitialAfterShow: true });
    readonly sidebar = new DouyinSidebar();
    readonly recorder = new DouyinRecorder();
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
