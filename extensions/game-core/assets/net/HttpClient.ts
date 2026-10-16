import {
    HttpError,
    type HttpMethod,
    type HttpRequest,
    type HttpResponse,
    type CancelSignal,
    type HttpTransport,
    type QueryValue,
    type TransportResponse,
} from './types';

export type RequestInterceptor = (request: HttpRequest) => HttpRequest | Promise<HttpRequest>;
export type ResponseInterceptor = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>;

export interface TokenProvider {
    getToken(): string | null;
    refresh(): Promise<string | null>;
}

export interface BusinessResult {
    ok: boolean;
    data?: unknown;
    code?: string | number;
    message?: string;
}

export interface HttpClientOptions {
    transport: HttpTransport;
    baseUrl?: string;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    maxConcurrent?: number;
    tokenProvider?: TokenProvider;
    authHeader?: (token: string) => [string, string];
    businessCheck?: (data: unknown) => BusinessResult;
    onError?: (error: HttpError, request: HttpRequest) => void;
    sleep?: (ms: number) => Promise<void>;
}

const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set(['GET', 'PUT', 'DELETE']);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function buildUrl(baseUrl: string, url: string, query?: Record<string, QueryValue>): string {
    const absolute = /^https?:\/\//.test(url);
    const full = absolute ? url : `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    const pairs = Object.entries(query ?? {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    if (pairs.length === 0) return full;
    return `${full}${full.includes('?') ? '&' : '?'}${pairs.join('&')}`;
}

function isRetryable(err: unknown): boolean {
    if (!(err instanceof HttpError)) return false;
    if (err.kind === 'network' || err.kind === 'timeout') return true;
    return err.kind === 'http' && (err.status ?? 0) >= 500;
}

function abortedError(): HttpError {
    return new HttpError('aborted', '请求已取消');
}

function cancellable<T>(task: Promise<T>, signal: CancelSignal | undefined, onCancel?: () => void): Promise<T> {
    if (!signal) return task;
    if (signal.cancelled) {
        onCancel?.();
        return Promise.reject(abortedError());
    }
    return new Promise<T>((resolve, reject) => {
        const detach = signal.onCancel(() => {
            onCancel?.();
            reject(abortedError());
        });
        task.then(
            (value) => {
                detach();
                resolve(value);
            },
            (err: unknown) => {
                detach();
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

class Semaphore {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async acquire(signal?: CancelSignal): Promise<() => void> {
        if (this.active < this.limit) {
            this.active++;
        } else {
            let grant!: () => void;
            const granted = new Promise<void>((resolve) => (grant = resolve));
            this.waiting.push(grant);
            try {
                await cancellable(granted, signal, () => {
                    const index = this.waiting.indexOf(grant);
                    if (index >= 0) this.waiting.splice(index, 1);
                });
            } catch (err) {
                if (!this.waiting.includes(grant)) void granted.then(() => this.handOff());
                throw err;
            }
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.handOff();
        };
    }

    private handOff() {
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
    }
}

export class HttpClient {
    private readonly requestInterceptors: RequestInterceptor[] = [];
    private readonly responseInterceptors: ResponseInterceptor[] = [];
    private readonly semaphore: Semaphore;
    private refreshing: Promise<string | null> | null = null;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(private readonly options: HttpClientOptions) {
        this.semaphore = new Semaphore(options.maxConcurrent ?? 10);
        this.sleep = options.sleep ?? defaultSleep;
    }

    configure(options: Partial<Omit<HttpClientOptions, 'maxConcurrent'>>) {
        Object.assign(this.options, options);
    }

    useRequest(interceptor: RequestInterceptor): () => void {
        this.requestInterceptors.push(interceptor);
        return () => this.remove(this.requestInterceptors, interceptor);
    }

    useResponse(interceptor: ResponseInterceptor): () => void {
        this.responseInterceptors.push(interceptor);
        return () => this.remove(this.responseInterceptors, interceptor);
    }

    get<T>(url: string, query?: Record<string, QueryValue>, init?: Partial<HttpRequest>) {
        return this.request<T>({ ...init, method: 'GET', url, query });
    }

    post<T>(url: string, body?: unknown, init?: Partial<HttpRequest>) {
        return this.request<T>({ ...init, method: 'POST', url, body });
    }

    put<T>(url: string, body?: unknown, init?: Partial<HttpRequest>) {
        return this.request<T>({ ...init, method: 'PUT', url, body });
    }

    delete<T>(url: string, init?: Partial<HttpRequest>) {
        return this.request<T>({ ...init, method: 'DELETE', url });
    }

    async request<T = unknown>(input: HttpRequest): Promise<HttpResponse<T>> {
        let request = input;
        for (const interceptor of this.requestInterceptors) request = await interceptor(request);

        const retries = IDEMPOTENT.has(request.method) ? (request.retries ?? this.options.retries ?? 2) : 0;
        let attempt = 0;
        for (;;) {
            try {
                return (await this.sendWithAuth(request)) as HttpResponse<T>;
            } catch (err) {
                const failure = request.signal?.cancelled ? abortedError() : err;
                if (attempt >= retries || !isRetryable(failure)) {
                    if (failure instanceof HttpError) this.options.onError?.(failure, request);
                    throw failure;
                }
                try {
                    await cancellable(this.sleep((this.options.retryDelayMs ?? 300) * 2 ** attempt), request.signal);
                } catch (cancelled) {
                    if (cancelled instanceof HttpError) this.options.onError?.(cancelled, request);
                    throw cancelled;
                }
                attempt++;
            }
        }
    }

    private async sendWithAuth(request: HttpRequest): Promise<HttpResponse> {
        const provider = request.skipAuth ? undefined : this.options.tokenProvider;
        if (!provider) return this.send(request, null);
        if (this.refreshing) await cancellable(this.refreshing, request.signal);
        const used = provider.getToken();
        try {
            return await this.send(request, used);
        } catch (err) {
            if (!(err instanceof HttpError) || err.status !== 401 || request.skipRefresh) throw err;
            const current = provider.getToken();
            const token = current && current !== used ? current : await this.refreshToken(provider);
            if (!token) throw err;
            return this.send(request, token);
        }
    }

    private refreshToken(provider: TokenProvider): Promise<string | null> {
        if (!this.refreshing) {
            this.refreshing = provider
                .refresh()
                .catch(() => null)
                .finally(() => {
                    this.refreshing = null;
                });
        }
        return this.refreshing;
    }

    private async send(request: HttpRequest, token: string | null): Promise<HttpResponse> {
        if (request.signal?.cancelled) throw abortedError();
        const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };
        let body: string | undefined;
        if (request.body !== undefined) {
            body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
            if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
                headers['Content-Type'] = 'application/json';
            }
        }
        if (token) {
            const [name, value] = this.options.authHeader?.(token) ?? ['Authorization', `Bearer ${token}`];
            headers[name] = value;
        }

        const release = await this.semaphore.acquire(request.signal);
        let raw: TransportResponse;
        try {
            if (request.signal?.cancelled) throw abortedError();
            raw = await this.options.transport.send({
                method: request.method,
                url: buildUrl(this.options.baseUrl ?? '', request.url, request.query),
                headers,
                body,
                timeoutMs: request.timeoutMs ?? this.options.timeoutMs ?? 10000,
                signal: request.signal,
            });
        } finally {
            release();
        }

        let data: unknown = raw.body;
        if (raw.body !== '' && /json/i.test(raw.headers['content-type'] ?? 'application/json')) {
            try {
                data = JSON.parse(raw.body);
            } catch {
                if (raw.status >= 200 && raw.status < 300)
                    throw new HttpError('parse', '响应不是合法 JSON', raw.status);
            }
        }
        if (raw.status < 200 || raw.status >= 300) {
            throw new HttpError('http', `HTTP ${raw.status}`, raw.status, undefined, data);
        }

        let response: HttpResponse = { status: raw.status, data, headers: raw.headers };
        if (this.options.businessCheck) {
            const result = this.options.businessCheck(data);
            if (!result.ok) {
                throw new HttpError('business', result.message ?? '业务错误', raw.status, result.code, data);
            }
            response = { ...response, data: result.data };
        }
        for (const interceptor of this.responseInterceptors) response = await interceptor(response);
        return response;
    }

    private remove<T>(list: T[], item: T) {
        const index = list.indexOf(item);
        if (index >= 0) list.splice(index, 1);
    }
}
