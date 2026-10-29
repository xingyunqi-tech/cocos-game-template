import type { IPlatform, LoginCredential, PlatformName } from '../platform/types';
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

export interface LoginRequest {
    platform: PlatformName;
    deviceId: string;
    credential: LoginCredential;
}

/** 后端协议与默认不同时提供；parse 返回的字段仍按默认规则校验，抛错按响应无效处理 */
export interface AuthProtocol {
    /** 默认 { platform, deviceId, ...credential } */
    buildLoginBody?: (request: LoginRequest) => unknown;
    /** 默认按 LoginResponse 读取响应 data */
    parseLoginResponse?: (data: unknown) => LoginResponse;
    /** 默认 { refreshToken } */
    buildRefreshBody?: (session: Readonly<AuthSession>) => unknown;
    /** 默认按 RefreshResponse 读取响应 data */
    parseRefreshResponse?: (data: unknown) => RefreshResponse;
}

/** guest：登录失败时以上次 userId 或设备游客身份进入；last-user：仅网络失败且有上次 userId 时离线进入 */
export type LoginFallback = 'guest' | 'last-user';

export interface AuthServiceOptions extends AuthProtocol {
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

function parseWith<T>(parse: ((data: unknown) => T) | undefined, data: unknown): Partial<T> | undefined {
    if (!parse) return data as Partial<T> | undefined;
    try {
        return parse(data);
    } catch (err) {
        throw new HttpError('parse', `响应解析失败：${err instanceof Error ? err.message : String(err)}`);
    }
}

export class AuthService implements TokenProvider {
    private current: AuthSession | null = null;
    private activeUser = '';
    private relogin: Promise<AuthSession> | null = null;
    private offlineEntry = false;
    private loggedOut = false;
    private epoch = 0;

    constructor(private readonly options: AuthServiceOptions) {}

    configure(options: Partial<Pick<AuthServiceOptions, 'fallback' | 'loginPath' | 'refreshPath'> & AuthProtocol>) {
        Object.assign(this.options, options);
    }

    get session(): Readonly<AuthSession> | null {
        return this.current;
    }

    /** 当前存档使用的 userId，离线进入时为回退身份 */
    get userId(): string {
        return this.activeUser;
    }

    /** 本设备从未登录成功时离线进入使用的游客身份 */
    get guestId(): string {
        return `guest-${this.options.deviceId()}`;
    }

    /** 离线进入且尚未重新登录成功 */
    get offline(): boolean {
        return this.offlineEntry;
    }

    async login(signal?: CancelSignal): Promise<LoginOutcome> {
        this.loggedOut = false;
        this.epoch++;
        this.relogin = null;
        try {
            const session = await this.loginOnline(signal, true, this.epoch);
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
        if (this.loggedOut) return Promise.resolve(false);
        return this.loginInBackground().then(
            () => true,
            () => false,
        );
    }

    /** 清除会话；之后不自动重新登录，直到再次调用 login() */
    logout() {
        this.current = null;
        this.loggedOut = true;
        this.epoch++;
        this.relogin = null;
    }

    getToken(): string | null {
        return this.current?.token ?? null;
    }

    /** 刷新失败为网络错误、超时或 5xx 时保留会话并返回 null；其他失败清除会话后重新登录 */
    async refresh(): Promise<string | null> {
        if (this.loggedOut) return null;
        const session = this.current;
        const epoch = this.epoch;
        if (session) {
            try {
                const res = await this.options.http.post(
                    this.options.refreshPath ?? '/auth/refresh',
                    this.options.buildRefreshBody?.(session) ?? { refreshToken: session.refreshToken },
                    { skipAuth: true },
                );
                const data = parseWith(this.options.parseRefreshResponse, res.data);
                if (typeof data?.token !== 'string' || !data.token) throw invalidResponse();
                if (epoch !== this.epoch || this.current !== session) return this.current?.token ?? null;
                this.current = {
                    ...session,
                    token: data.token,
                    refreshToken: data.refreshToken ?? session.refreshToken,
                    expiresAt: this.now() + (data.expiresIn ?? 0) * 1000,
                };
                return this.current.token;
            } catch (err) {
                if (err instanceof HttpError && isOfflineError(err)) return null;
                if (epoch !== this.epoch) return null;
                if (this.current !== session) return this.current?.token ?? null;
                this.current = null;
            }
        }
        try {
            return (await this.loginInBackground()).token;
        } catch {
            return null;
        }
    }

    private loginInBackground(): Promise<AuthSession> {
        if (this.relogin) return this.relogin;
        const relogin = this.loginOnline(undefined, false, this.epoch).finally(() => {
            if (this.relogin === relogin) this.relogin = null;
        });
        this.relogin = relogin;
        return relogin;
    }

    private fallbackUser(err: unknown): string {
        const last = this.options.lastUser.get();
        if ((this.options.fallback ?? 'guest') === 'guest') return last || this.guestId;
        return last && isOfflineError(err) ? last : '';
    }

    private async loginOnline(
        signal: CancelSignal | undefined,
        switchUser: boolean,
        epoch: number,
    ): Promise<AuthSession> {
        const platform = this.options.platform();
        const credential = await this.platformLogin(platform, signal);
        const requestStartedAt = (this.options.mark ?? this.options.now ?? Date.now)();
        const deviceId = this.options.deviceId();
        if (!credential.code && !credential.anonymousCode) credential.anonymousCode = deviceId;
        const request: LoginRequest = { platform: platform.name, deviceId, credential };
        const res = await this.options.http.post(
            this.options.loginPath ?? '/auth/login',
            this.options.buildLoginBody?.(request) ?? { platform: platform.name, deviceId, ...credential },
            { skipAuth: true, signal },
        );
        const data = parseWith(this.options.parseLoginResponse, res.data);
        if (typeof data?.serverTime === 'number') this.options.onServerTime?.(data.serverTime, requestStartedAt);
        if (typeof data?.token !== 'string' || !data.token || (data.userId ?? '') === '') throw invalidResponse();
        if (String(data.userId).includes(':'))
            throw new HttpError('parse', `userId 不能包含冒号：${String(data.userId)}`);
        if (epoch !== this.epoch) throw new HttpError('aborted', '登录状态已变化');
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
