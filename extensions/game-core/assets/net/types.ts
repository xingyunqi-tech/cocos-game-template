export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface CancelSignal {
    readonly cancelled: boolean;
    onCancel(listener: () => void): () => void;
}

export interface HttpRequest {
    method: HttpMethod;
    url: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    skipAuth?: boolean;
    /** 携带当前 token，但 401 时不刷新、不重新登录 */
    skipRefresh?: boolean;
    signal?: CancelSignal;
}

export interface HttpResponse<T = unknown> {
    status: number;
    data: T;
    headers: Record<string, string>;
}

export interface TransportRequest {
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    signal?: CancelSignal;
}

export interface TransportResponse {
    status: number;
    body: string;
    headers: Record<string, string>;
}

export interface HttpTransport {
    send(request: TransportRequest): Promise<TransportResponse>;
}

export type HttpErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'parse' | 'business';

export class HttpError extends Error {
    constructor(
        readonly kind: HttpErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: string | number,
        readonly data?: unknown,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export class CancelSource {
    private readonly state = { done: false, listeners: new Set<() => void>() };

    readonly signal: CancelSignal;

    constructor() {
        const state = this.state;
        this.signal = {
            get cancelled() {
                return state.done;
            },
            onCancel(listener) {
                if (state.done) {
                    listener();
                    return () => undefined;
                }
                state.listeners.add(listener);
                return () => {
                    state.listeners.delete(listener);
                };
            },
        };
    }

    cancel() {
        if (this.state.done) return;
        this.state.done = true;
        for (const listener of Array.from(this.state.listeners)) listener();
        this.state.listeners.clear();
    }
}
