import { describe, expect, it, vi } from 'vitest';
import { buildUrl, HttpClient, type TokenProvider } from 'db://game-core/net/HttpClient';
import { MockTransport } from 'db://game-core/net/MockTransport';
import {
    CancelSource,
    HttpError,
    type HttpTransport,
    type TransportRequest,
    type TransportResponse,
} from 'db://game-core/net/types';

const noSleep = () => Promise.resolve();

function client(transport: HttpTransport, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
    return new HttpClient({ transport, baseUrl: 'https://api.test/', sleep: noSleep, ...extra });
}

describe('buildUrl', () => {
    it('joins base url, path and query', () => {
        expect(buildUrl('https://a.com/', '/v1/x', { a: 1, b: 'c d', skip: undefined })).toBe(
            'https://a.com/v1/x?a=1&b=c%20d',
        );
    });

    it('keeps absolute urls', () => {
        expect(buildUrl('https://a.com', 'https://b.com/y?z=1', { q: true })).toBe('https://b.com/y?z=1&q=true');
    });
});

describe('HttpClient', () => {
    it('sends JSON body and parses JSON response', async () => {
        const mock = new MockTransport().on('POST', '/echo', (req) => ({ body: { got: req.body } }));
        const res = await client(mock).post<{ got: unknown }>('echo', { a: 1 });
        expect(res.data).toEqual({ got: { a: 1 } });
    });

    it('adds a JSON content type only when none is set in any letter case', async () => {
        const seen: Array<Record<string, string>> = [];
        const mock = new MockTransport().on('POST', '/echo', (req) => {
            seen.push(req.headers);
            return { body: {} };
        });
        await client(mock).post('echo', { a: 1 });
        await client(mock).post('echo', 'a=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
        expect(seen[0]['Content-Type']).toBe('application/json');
        expect(seen[1]).not.toHaveProperty('Content-Type');
        expect(seen[1]['content-type']).toBe('application/x-www-form-urlencoded');
    });

    it('keeps one accept and one authorization header whatever their letter case', async () => {
        const seen: Array<Record<string, string>> = [];
        const mock = new MockTransport().on('GET', '/me', (req) => {
            seen.push(req.headers);
            return { body: {} };
        });
        const tokenProvider: TokenProvider = { getToken: () => 't', refresh: () => Promise.resolve(null) };
        await client(mock, { tokenProvider }).get('me', undefined, {
            headers: { accept: 'text/plain', authorization: 'Basic x' },
        });
        expect(seen[0]).toEqual({ accept: 'text/plain', Authorization: 'Bearer t' });
    });

    it('rejects non-2xx responses with http errors', async () => {
        const mock = new MockTransport().on('GET', '/missing', () => ({ status: 404, body: { msg: 'no' } }));
        await expect(client(mock).get('missing')).rejects.toMatchObject({ kind: 'http', status: 404 });
    });

    it('retries idempotent requests on 5xx with exponential backoff', async () => {
        let calls = 0;
        const mock = new MockTransport().on('GET', '/flaky', () =>
            ++calls < 3 ? { status: 503 } : { body: { ok: 1 } },
        );
        const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
        const res = await client(mock, { sleep, retries: 2, retryDelayMs: 100 }).get('flaky');
        expect(res.data).toEqual({ ok: 1 });
        expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
    });

    it('does not retry POST requests', async () => {
        let calls = 0;
        const mock = new MockTransport().on('POST', '/pay', () => {
            calls++;
            return { status: 503 };
        });
        await expect(client(mock).post('pay', {})).rejects.toBeInstanceOf(HttpError);
        expect(calls).toBe(1);
    });

    it('does not retry 4xx responses', async () => {
        let calls = 0;
        const mock = new MockTransport().on('GET', '/bad', () => {
            calls++;
            return { status: 400 };
        });
        await expect(client(mock).get('bad')).rejects.toMatchObject({ status: 400 });
        expect(calls).toBe(1);
    });

    it('refreshes the token once for concurrent 401 responses and replays the requests', async () => {
        let token = 'old';
        const refresh = vi.fn(() => {
            token = 'new';
            return Promise.resolve(token);
        });
        const provider: TokenProvider = { getToken: () => token, refresh };
        const mock = new MockTransport().on('GET', '/me', (req) =>
            req.headers.Authorization === 'Bearer new' ? { body: { id: 1 } } : { status: 401 },
        );
        const http = client(mock, { tokenProvider: provider });
        const results = await Promise.all([http.get('me'), http.get('me'), http.get('me')]);
        expect(results.map((r) => r.data)).toEqual([{ id: 1 }, { id: 1 }, { id: 1 }]);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes on business errors that isAuthError treats as an expired token', async () => {
        let token = 'old';
        const refresh = vi.fn(() => Promise.resolve((token = 'new')));
        const mock = new MockTransport().on('GET', '/me', (req) => ({
            body: req.headers.Authorization === 'Bearer new' ? { code: 0, data: { id: 1 } } : { code: 40101 },
        }));
        const http = client(mock, {
            tokenProvider: { getToken: () => token, refresh },
            businessCheck: (data) => {
                const body = data as { code: number; data?: unknown };
                return { ok: body.code === 0, code: body.code, data: body.data };
            },
            isAuthError: (error) => error.status === 401 || error.code === 40101,
        });
        await expect(http.get('me')).resolves.toMatchObject({ data: { id: 1 } });
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('keeps the original error when isAuthError throws', async () => {
        const refresh = vi.fn(() => Promise.resolve('new'));
        const mock = new MockTransport().on('GET', '/me', () => ({ status: 401 }));
        const http = client(mock, {
            tokenProvider: { getToken: () => 'old', refresh },
            isAuthError: () => {
                throw new Error('bad check');
            },
        });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(http.get('me')).rejects.toMatchObject({ kind: 'http', status: 401 });
        expect(refresh).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('does not refresh on business errors by default', async () => {
        const refresh = vi.fn(() => Promise.resolve('new'));
        const mock = new MockTransport().on('GET', '/me', () => ({ body: { code: 40101 } }));
        const http = client(mock, {
            tokenProvider: { getToken: () => 'old', refresh },
            businessCheck: (data) => ({ ok: false, code: (data as { code: number }).code }),
        });
        await expect(http.get('me')).rejects.toMatchObject({ kind: 'business', code: 40101 });
        expect(refresh).not.toHaveBeenCalled();
    });

    it('surfaces the 401 when the refresh yields no token', async () => {
        const provider: TokenProvider = { getToken: () => 'x', refresh: () => Promise.resolve(null) };
        const mock = new MockTransport().on('GET', '/me', () => ({ status: 401 }));
        await expect(client(mock, { tokenProvider: provider }).get('me')).rejects.toMatchObject({ status: 401 });
    });

    it('sends the token but does not refresh on 401 when skipRefresh is set', async () => {
        const seen: string[] = [];
        const refresh = vi.fn(() => Promise.resolve('new'));
        const mock = new MockTransport().on('POST', '/track', (req) => {
            seen.push(req.headers.Authorization ?? 'none');
            return { status: 401 };
        });
        const http = client(mock, { tokenProvider: { getToken: () => 'old', refresh } });
        await expect(http.post('track', {}, { skipRefresh: true })).rejects.toMatchObject({ status: 401 });
        expect(seen).toEqual(['Bearer old']);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('skips auth headers when skipAuth is set', async () => {
        const seen: string[] = [];
        const mock = new MockTransport().on('POST', '/login', (req) => {
            seen.push(req.headers.Authorization ?? 'none');
            return { body: {} };
        });
        const provider: TokenProvider = { getToken: () => 't', refresh: () => Promise.resolve('t') };
        await client(mock, { tokenProvider: provider }).post('login', {}, { skipAuth: true });
        expect(seen).toEqual(['none']);
    });

    it('maps business failures through businessCheck', async () => {
        const mock = new MockTransport()
            .on('GET', '/ok', () => ({ body: { code: 0, data: { v: 1 } } }))
            .on('GET', '/fail', () => ({ body: { code: 1001, msg: '余额不足' } }));
        const http = client(mock, {
            businessCheck: (data) => {
                const d = data as { code: number; data?: unknown; msg?: string };
                return { ok: d.code === 0, data: d.data, code: d.code, message: d.msg };
            },
        });
        await expect(http.get('ok')).resolves.toMatchObject({ data: { v: 1 } });
        await expect(http.get('fail')).rejects.toMatchObject({ kind: 'business', code: 1001, message: '余额不足' });
    });

    it('applies request and response interceptors in order', async () => {
        const mock = new MockTransport().on('GET', '/h', (req) => ({ body: { trace: req.headers['X-Trace'] } }));
        const http = client(mock);
        http.useRequest((req) => ({ ...req, headers: { ...req.headers, 'X-Trace': 'abc' } }));
        http.useResponse((res) => ({ ...res, data: { wrapped: res.data } }));
        await expect(http.get('h')).resolves.toMatchObject({ data: { wrapped: { trace: 'abc' } } });
    });

    it('rejects cancelled requests without calling the transport', async () => {
        const send = vi.fn<HttpTransport['send']>();
        const source = new CancelSource();
        source.cancel();
        await expect(client({ send }).get('x', undefined, { signal: source.signal })).rejects.toMatchObject({
            kind: 'aborted',
        });
        expect(send).not.toHaveBeenCalled();
    });

    it('limits concurrent transport calls', async () => {
        let active = 0;
        let peak = 0;
        const releases: Array<() => void> = [];
        const transport: HttpTransport = {
            send: () =>
                new Promise((resolve) => {
                    active++;
                    peak = Math.max(peak, active);
                    releases.push(() => {
                        active--;
                        resolve({ status: 200, body: '{}', headers: {} });
                    });
                }),
        };
        const http = new HttpClient({ transport, maxConcurrent: 2, sleep: noSleep });
        const all = Promise.all(Array.from({ length: 5 }, () => http.get('x')));
        for (let i = 0; i < 5; i++) {
            await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
            releases.shift()?.();
        }
        await all;
        expect(peak).toBe(2);
    });
});

function deferredTransport() {
    const pending: Array<{ req: TransportRequest; resolve: (res: TransportResponse) => void }> = [];
    let active = 0;
    let peak = 0;
    const transport: HttpTransport = {
        send: (req) =>
            new Promise((resolve) => {
                active++;
                peak = Math.max(peak, active);
                pending.push({
                    req,
                    resolve: (res) => {
                        active--;
                        resolve(res);
                    },
                });
            }),
    };
    return { transport, pending, peak: () => peak };
}

const OK: TransportResponse = { status: 200, body: '{}', headers: {} };

describe('HttpClient concurrency and cancellation', () => {
    it('hands a released slot to the queued request without admitting a newcomer', async () => {
        const { transport, pending, peak } = deferredTransport();
        const http = new HttpClient({ transport, maxConcurrent: 1, sleep: noSleep });
        const a = http.get('a');
        const b = http.get('b');
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        pending.shift()?.resolve(OK);
        const c = http.get('c');
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        expect(pending[0].req.url).toBe('/b');
        pending.shift()?.resolve(OK);
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        pending.shift()?.resolve(OK);
        await Promise.all([a, b, c]);
        expect(peak()).toBe(1);
    });

    it('rejects a queued request immediately when cancelled and frees its place', async () => {
        const { transport, pending } = deferredTransport();
        const http = new HttpClient({ transport, maxConcurrent: 1, sleep: noSleep });
        const first = http.get('a');
        const source = new CancelSource();
        const queued = http.get('b', undefined, { signal: source.signal });
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        source.cancel();
        await expect(queued).rejects.toMatchObject({ kind: 'aborted' });
        pending.shift()?.resolve(OK);
        await first;
        const next = http.get('c');
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        expect(pending[0].req.url).toBe('/c');
        pending.shift()?.resolve(OK);
        await next;
    });

    it('rejects during retry backoff when cancelled', async () => {
        const sleep = vi.fn(() => new Promise<void>(() => undefined));
        const mock = new MockTransport().on('GET', '/down', () => ({ status: 503 }));
        const source = new CancelSource();
        const pendingRequest = client(mock, { sleep }).get('down', undefined, { signal: source.signal });
        await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce());
        source.cancel();
        await expect(pendingRequest).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('replays a late 401 with the already refreshed token without refreshing again', async () => {
        let token = 'old';
        const refresh = vi.fn(() => {
            token = 'new';
            return Promise.resolve(token);
        });
        const { transport, pending } = deferredTransport();
        const http = new HttpClient({ transport, sleep: noSleep, tokenProvider: { getToken: () => token, refresh } });
        const take = (url: string, auth: string) => {
            const index = pending.findIndex((p) => p.req.url === url && p.req.headers.Authorization === auth);
            return index >= 0 ? pending.splice(index, 1)[0] : undefined;
        };
        const unauthorized: TransportResponse = { status: 401, body: '', headers: {} };
        const fast = http.get('fast');
        const slow = http.get('slow');
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        take('/fast', 'Bearer old')?.resolve(unauthorized);
        await vi.waitFor(() => expect(pending.some((p) => p.req.headers.Authorization === 'Bearer new')).toBe(true));
        take('/slow', 'Bearer old')?.resolve(unauthorized);
        await vi.waitFor(() =>
            expect(pending.filter((p) => p.req.headers.Authorization === 'Bearer new')).toHaveLength(2),
        );
        take('/fast', 'Bearer new')?.resolve(OK);
        take('/slow', 'Bearer new')?.resolve(OK);
        await expect(Promise.all([fast, slow])).resolves.toHaveLength(2);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('holds new requests until an in-flight refresh completes', async () => {
        let token = 'old';
        let finishRefresh: () => void = () => undefined;
        const refresh = vi.fn(
            () =>
                new Promise<string>((resolve) => {
                    finishRefresh = () => {
                        token = 'new';
                        resolve(token);
                    };
                }),
        );
        const seen: string[] = [];
        const mock = new MockTransport().on('GET', '/me', (req) => {
            seen.push(req.headers.Authorization ?? '');
            return req.headers.Authorization === 'Bearer new' ? { body: {} } : { status: 401 };
        });
        const http = client(mock, { tokenProvider: { getToken: () => token, refresh } });
        const first = http.get('me');
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        const second = http.get('me');
        finishRefresh();
        await Promise.all([first, second]);
        expect(seen).toEqual(['Bearer old', 'Bearer new', 'Bearer new']);
    });

    it('refreshes on 401 for a request that waited on a failed proactive refresh', async () => {
        let token = 'old';
        let expiring = true;
        let failExpiring: () => void = () => undefined;
        const refresh = vi.fn((reason?: 'expiring' | 'expired') => {
            if (reason === 'expiring') {
                expiring = false;
                return new Promise<string | null>((resolve) => (failExpiring = () => resolve(null)));
            }
            return new Promise<string>((resolve) =>
                setTimeout(() => {
                    token = 'new';
                    resolve(token);
                }, 10),
            );
        });
        const mock = new MockTransport().on('GET', '/me', (req) =>
            req.headers.Authorization === 'Bearer new' ? { body: {} } : { status: 401 },
        );
        const http = client(mock, { tokenProvider: { getToken: () => token, refresh, shouldRefresh: () => expiring } });
        const first = http.get('me');
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        const second = http.get('me');
        failExpiring();
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(refresh.mock.calls).toEqual([['expiring'], ['expired']]);
    });

    it('refreshes as expired when a 401 joins a proactive refresh that fails', async () => {
        let token = 'old';
        let expiring = false;
        let failExpiring: () => void = () => undefined;
        const refresh = vi.fn((reason?: 'expiring' | 'expired') => {
            if (reason === 'expiring') {
                return new Promise<string | null>((resolve) => (failExpiring = () => resolve(null)));
            }
            token = 'new';
            return Promise.resolve(token);
        });
        let reject401: () => void = () => undefined;
        const transport: HttpTransport = {
            send: (req: TransportRequest) => {
                if (req.headers.Authorization === 'Bearer new') {
                    return Promise.resolve({ status: 200, body: '{}', headers: {} });
                }
                if (req.url.endsWith('/slow')) {
                    return new Promise<TransportResponse>(
                        (resolve) => (reject401 = () => resolve({ status: 401, body: '', headers: {} })),
                    );
                }
                return Promise.resolve({ status: 401, body: '', headers: {} });
            },
        };
        const http = client(transport, {
            tokenProvider: { getToken: () => token, refresh, shouldRefresh: () => expiring },
        });
        const slow = http.get('slow');
        await vi.waitFor(() => expect(reject401).not.toBe(undefined));
        expiring = true;
        const proactive = http.get('me');
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expiring = false;
        reject401();
        await new Promise((resolve) => setTimeout(resolve, 0));
        failExpiring();
        await expect(Promise.all([slow, proactive])).resolves.toHaveLength(2);
        expect(refresh.mock.calls).toEqual([['expiring'], ['expired']]);
    });

    it('reports final failures through onError but not successful retries', async () => {
        const onError = vi.fn();
        let calls = 0;
        const mock = new MockTransport()
            .on('GET', '/flaky', () => (++calls < 2 ? { status: 503 } : { body: {} }))
            .on('GET', '/dead', () => ({ status: 500 }));
        const http = client(mock, { retries: 1 });
        http.onError(onError);
        await http.get('flaky');
        await expect(http.get('dead')).rejects.toBeInstanceOf(HttpError);
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][1]).toMatchObject({ url: 'dead' });
    });

    it('notifies every error listener until it unsubscribes, even when one throws', async () => {
        const mock = new MockTransport().on('GET', '/dead', () => ({ status: 400 }));
        const http = client(mock);
        const first = vi.fn(() => {
            throw new Error('listener');
        });
        const second = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        http.onError(first);
        const off = http.onError(second);
        await expect(http.get('dead')).rejects.toBeInstanceOf(HttpError);
        off();
        await expect(http.get('dead')).rejects.toBeInstanceOf(HttpError);
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });
});

describe('MockTransport', () => {
    it('times out delayed replies and honours cancellation', async () => {
        const mock = new MockTransport().on('GET', '/slow', () => ({ body: {}, delayMs: 1000 }));
        const http = client(mock, { timeoutMs: 10, retries: 0 });
        await expect(http.get('slow')).rejects.toMatchObject({ kind: 'timeout' });
        const source = new CancelSource();
        const pendingRequest = client(mock).get('slow', undefined, { signal: source.signal });
        source.cancel();
        await expect(pendingRequest).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('rejects a delayed reply with aborted when cancelled while the handler runs', async () => {
        const source = new CancelSource();
        const mock = new MockTransport().on('GET', '/slow', () => {
            source.cancel();
            return { body: {}, delayMs: 1000 };
        });
        const request: TransportRequest = {
            method: 'GET',
            url: 'https://api.test/slow',
            headers: {},
            timeoutMs: 5000,
            signal: source.signal,
        };
        await expect(mock.send(request)).rejects.toMatchObject({ kind: 'aborted' });
    });
});
