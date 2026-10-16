import type { IPlatform, LoginCredential } from '../platform/types';
import type { HttpClient, TokenProvider } from './HttpClient';
import { HttpError, type CancelSignal } from './types';

export interface LoginResponse {
    token: string;
    refreshToken: string;
    userId: string | number;
    expiresIn: number;
    /** 服务器当前时间戳（毫秒），用于校准 serverTime */
    serverTime?: number;
}

export interface RefreshResponse {
    token: string;
    refreshToken?: string;
    expiresIn: number;
}

export interface AuthSession {
    token: string;
    refreshToken: string;
    userId: string;
    expiresAt: number;
}

export interface LoginOutcome {
    userId: string;
    offline: boolean;
}

/** guest：登录失败时以上次 userId 或设备游客身份进入；last-user：仅网络失败且有上次 userId 时离线进入 */
export type LoginFallback = 'guest' | 'last-user';

export interface AuthServiceOptions {
    http: HttpClient;
    platform: () => IPlatform;
    deviceId: () => string;
    lastUser: { get(): string; set(userId: string): void };
    onUser?: (userId: string) => void;
    onWarn?: (message: string, detail: Record<string, unknown>) => void;
    onServerTime?: (serverMs: number, requestStartedAt: number) => void;
    /** 离线进入后重新登录成功时回调 */
    onRecovered?: (userId: string) => void;
    /** 发起登录请求时的时钟读数，传回 onServerTime */
    mark?: () => number;
    fallback?: LoginFallback;
    /** 平台登录（wx.login / tt.login）超时，超时按网络错误处理 */
    platformLoginTimeoutMs?: number;
    loginPath?: string;
    refreshPath?: string;
    now?: () => number;
}

function isOfflineError(err: unknown): boolean {
    if (err instanceof HttpError) {
        if (err.kind === 'network' || err.kind === 'timeout') return true;
        return err.kind === 'http' && (err.status ?? 0) >= 500;
    }
    return typeof err === 'object' && err !== null && 'errMsg' in err;
}

export const PLATFORM_LOGIN_TIMEOUT_MS = 10000;

function invalidResponse(): HttpError {
    return new HttpError('parse', '登录响应缺少 token 或 userId');
}

export class AuthService implements TokenProvider {
    private current: AuthSession | null = null;
    private activeUser = '';
    private reconnecting: Promise<boolean> | null = null;
    private offlineEntry = false;

    constructor(private readonly options: AuthServiceOptions) {}

    configure(options: Partial<Pick<AuthServiceOptions, 'fallback' | 'loginPath' | 'refreshPath'>>) {
        Object.assign(this.options, options);
    }

    get session(): Readonly<AuthSession> | null {
        return this.current;
    }

    /** 当前存档使用的 userId，离线进入时为回退身份 */
    get userId(): string {
        return this.activeUser;
    }

    /** 离线进入且尚未重新登录成功 */
    get offline(): boolean {
        return this.offlineEntry;
    }

    async login(signal?: CancelSignal): Promise<LoginOutcome> {
        try {
            const session = await this.loginOnline(signal, true);
            return { userId: session.userId, offline: false };
        } catch (err) {
            if (err instanceof HttpError && err.kind === 'aborted') throw err;
            const userId = this.fallbackUser(err);
            if (!userId) throw err;
            this.current = null;
            this.offlineEntry = true;
            this.options.onUser?.(userId);
            this.activeUser = userId;
            this.options.onWarn?.('登录失败，离线进入', { error: err instanceof Error ? err.message : String(err) });
            return { userId, offline: true };
        }
    }

    /** 离线进入后重新联网登录；userId 与当前存档不一致时只更新会话，存档作用域下次启动生效 */
    reconnect(): Promise<boolean> {
        if (this.current) return Promise.resolve(true);
        this.reconnecting ??= this.loginOnline(undefined, false)
            .then(
                () => true,
                () => false,
            )
            .finally(() => {
                this.reconnecting = null;
            });
        return this.reconnecting;
    }

    logout() {
        this.current = null;
    }

    getToken(): string | null {
        return this.current?.token ?? null;
    }

    async refresh(): Promise<string | null> {
        const session = this.current;
        if (session) {
            try {
                const res = await this.options.http.post<RefreshResponse>(
                    this.options.refreshPath ?? '/auth/refresh',
                    { refreshToken: session.refreshToken },
                    { skipAuth: true },
                );
                if (typeof res.data?.token !== 'string' || !res.data.token) throw invalidResponse();
                this.current = {
                    ...session,
                    token: res.data.token,
                    refreshToken: res.data.refreshToken ?? session.refreshToken,
                    expiresAt: this.now() + res.data.expiresIn * 1000,
                };
                return this.current.token;
            } catch {
                this.current = null;
            }
        }
        try {
            return (await this.loginOnline(undefined, false)).token;
        } catch {
            return null;
        }
    }

    private fallbackUser(err: unknown): string {
        const last = this.options.lastUser.get();
        if ((this.options.fallback ?? 'guest') === 'guest') return last || `guest-${this.options.deviceId()}`;
        return last && isOfflineError(err) ? last : '';
    }

    private async loginOnline(signal: CancelSignal | undefined, switchUser: boolean): Promise<AuthSession> {
        const platform = this.options.platform();
        const credential = await this.platformLogin(platform, signal);
        const requestStartedAt = (this.options.mark ?? this.options.now ?? Date.now)();
        const deviceId = this.options.deviceId();
        if (!credential.code && !credential.anonymousCode) credential.anonymousCode = deviceId;
        const res = await this.options.http.post<LoginResponse>(
            this.options.loginPath ?? '/auth/login',
            { platform: platform.name, deviceId, ...credential },
            { skipAuth: true, signal },
        );
        const data = res.data;
        if (typeof data?.serverTime === 'number') this.options.onServerTime?.(data.serverTime, requestStartedAt);
        if (typeof data?.token !== 'string' || !data.token || (data.userId ?? '') === '') throw invalidResponse();
        if (String(data.userId).includes(':'))
            throw new HttpError('parse', `userId 不能包含冒号：${String(data.userId)}`);
        const session: AuthSession = {
            token: data.token,
            refreshToken: data.refreshToken ?? '',
            userId: String(data.userId),
            expiresAt: this.now() + (data.expiresIn ?? 0) * 1000,
        };
        if (switchUser || !this.activeUser) {
            this.options.onUser?.(session.userId);
            this.activeUser = session.userId;
        } else if (this.activeUser !== session.userId) {
            this.options.onWarn?.('登录用户与当前存档用户不一致，下次启动生效', {
                active: this.activeUser,
                userId: session.userId,
            });
        }
        this.current = session;
        this.options.lastUser.set(session.userId);
        const recovered = this.offlineEntry && !switchUser;
        this.offlineEntry = false;
        if (recovered) this.options.onRecovered?.(this.activeUser);
        return session;
    }

    private async platformLogin(platform: IPlatform, signal?: CancelSignal): Promise<LoginCredential> {
        const timeoutMs = this.options.platformLoginTimeoutMs ?? PLATFORM_LOGIN_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let detach: () => void = () => undefined;
        const guard = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new HttpError('timeout', `平台登录超时 ${timeoutMs}ms`)), timeoutMs);
            if (signal) detach = signal.onCancel(() => reject(new HttpError('aborted', '请求已取消')));
        });
        try {
            return await Promise.race([platform.login(), guard]);
        } finally {
            clearTimeout(timer);
            detach();
        }
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }
}
