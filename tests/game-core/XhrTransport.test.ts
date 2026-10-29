import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XhrTransport } from 'db://game-core/net/XhrTransport';
import { CancelSource, type TransportRequest } from 'db://game-core/net/types';

class FakeXhr {
    static last: FakeXhr | null = null;
    status = 0;
    responseText = '';
    timeout = 0;
    headers: Record<string, string> = {};
    aborted = false;
    rawHeaders = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;

    constructor() {
        FakeXhr.last = this;
    }

    open() {}

    setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
    }

    send() {}

    abort() {
        this.aborted = true;
        this.onabort?.();
    }

    getAllResponseHeaders() {
        return this.rawHeaders;
    }

    respond(status: number, body: string, rawHeaders = '') {
        this.status = status;
        this.responseText = body;
        this.rawHeaders = rawHeaders;
        this.onload?.();
    }
}

const request = (extra: Partial<TransportRequest> = {}): TransportRequest => ({
    method: 'GET',
    url: 'https://a.test/x',
    headers: { Accept: 'application/json' },
    timeoutMs: 1000,
    ...extra,
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('XhrTransport', () => {
    it('resolves with status, body and lower-cased headers', async () => {
        const pending = new XhrTransport().send(request());
        FakeXhr.last?.respond(200, '{"a":1}', 'Content-Type: application/json\r\nX-Id: 7\r\n');
        await expect(pending).resolves.toEqual({
            status: 200,
            body: '{"a":1}',
            headers: { 'content-type': 'application/json', 'x-id': '7' },
        });
        expect(FakeXhr.last?.headers).toEqual({ accept: 'application/json' });
    });

    it('sends header names in lower case so they replace mini-game adapter defaults', async () => {
        const pending = new XhrTransport().send(
            request({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' } }),
        );
        expect(FakeXhr.last?.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer t' });
        FakeXhr.last?.respond(200, '{}', '');
        await pending;
    });

    it('times out on the JS timer even when the platform ignores xhr.timeout', async () => {
        const pending = new XhrTransport().send(request({ timeoutMs: 50 }));
        vi.advanceTimersByTime(50);
        await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
        expect(FakeXhr.last?.aborted).toBe(true);
    });

    it('aborts and rejects when cancelled', async () => {
        const source = new CancelSource();
        const pending = new XhrTransport().send(request({ signal: source.signal }));
        source.cancel();
        await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
        expect(FakeXhr.last?.aborted).toBe(true);
    });

    it('rejects with a network error and stops its timer when the request cannot be sent', async () => {
        vi.useFakeTimers();
        try {
            const spy = vi.spyOn(FakeXhr.prototype, 'setRequestHeader').mockImplementation(() => {
                throw new SyntaxError('invalid header value');
            });
            const pending = new XhrTransport().send(request());
            await expect(pending).rejects.toMatchObject({
                kind: 'network',
                message: '请求发送失败：invalid header value',
            });
            spy.mockRestore();
            const sending = vi.spyOn(FakeXhr.prototype, 'send').mockImplementation(() => {
                throw new Error('bad state');
            });
            await expect(new XhrTransport().send(request())).rejects.toMatchObject({ kind: 'network' });
            sending.mockRestore();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('maps network errors', async () => {
        const pending = new XhrTransport().send(request());
        FakeXhr.last?.onerror?.();
        await expect(pending).rejects.toMatchObject({ kind: 'network' });
    });
});
