import { HttpError, type HttpMethod, type HttpTransport, type TransportRequest, type TransportResponse } from './types';

export interface MockRequest {
    method: HttpMethod;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
}

export interface MockReply {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
    delayMs?: number;
}

export type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

function splitUrl(url: string): { path: string; query: Record<string, string> } {
    const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '');
    const [path, search = ''] = withoutOrigin.split('?');
    const query: Record<string, string> = {};
    for (const pair of search.split('&').filter(Boolean)) {
        const [key, value = ''] = pair.split('=');
        query[decodeURIComponent(key)] = decodeURIComponent(value);
    }
    return { path: path || '/', query };
}

export class MockTransport implements HttpTransport {
    private delay(ms: number, request: TransportRequest): Promise<void> {
        return new Promise((resolve, reject) => {
            const done = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);
            const timeout = setTimeout(() => {
                cleanup();
                reject(new HttpError('timeout', `请求超时 ${request.timeoutMs}ms`));
            }, request.timeoutMs);
            const detach =
                request.signal?.onCancel(() => {
                    cleanup();
                    reject(new HttpError('aborted', '请求已取消'));
                }) ?? (() => undefined);
            function cleanup() {
                clearTimeout(done);
                clearTimeout(timeout);
                detach();
            }
        });
    }

    private readonly routes = new Map<string, MockHandler>();

    on(method: HttpMethod, path: string, handler: MockHandler): this {
        this.routes.set(`${method} ${path}`, handler);
        return this;
    }

    async send(request: TransportRequest): Promise<TransportResponse> {
        const { path, query } = splitUrl(request.url);
        const handler = this.routes.get(`${request.method} ${path}`);
        if (!handler) return { status: 404, body: '', headers: {} };
        let body: unknown = request.body;
        if (typeof request.body === 'string') {
            try {
                body = JSON.parse(request.body);
            } catch {
                body = request.body;
            }
        }
        const reply = await handler({ method: request.method, path, query, headers: request.headers, body });
        if (reply.delayMs) await this.delay(reply.delayMs, request);
        const text =
            reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        return {
            status: reply.status ?? 200,
            body: text,
            headers: { 'content-type': 'application/json', ...reply.headers },
        };
    }
}
