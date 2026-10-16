import { describe, expect, it, vi } from 'vitest';
import { AuthService, type LoginFallback } from 'db://game-core/net/AuthService';
import { HttpClient } from 'db://game-core/net/HttpClient';
import { MockTransport } from 'db://game-core/net/MockTransport';
import { CancelSource, HttpError } from 'db://game-core/net/types';
import type { IPlatform, LoginCredential } from 'db://game-core/platform/types';

interface SetupOptions {
    credential?: LoginCredential;
    lastUser?: string;
    loginError?: Record<string, unknown>;
    loginHangs?: boolean;
    fallback?: LoginFallback;
}

function setup(options: SetupOptions = {}) {
    const mock = new MockTransport();
    let n = 0;
    mock.on('POST', '/auth/login', ({ body }) => {
        const b = body as { code?: string; anonymousCode?: string };
        return {
            body: { token: `t${++n}`, refreshToken: 'r', userId: `u-${b.code ?? b.anonymousCode}`, expiresIn: 60 },
        };
    });
    const http = new HttpClient({
        transport: mock,
        baseUrl: 'https://api.test/',
        sleep: () => Promise.resolve(),
        timeoutMs: 50,
    });
    let last = options.lastUser ?? '';
    const onUser = vi.fn();
    const onWarn = vi.fn();
    const onRecovered = vi.fn();
    let credential = options.credential ?? { code: 'c' };
    const platform = {
        name: 'wechat',
        login: () =>
            options.loginHangs
                ? new Promise(() => undefined)
                : options.loginError
                  ? Promise.reject(Object.assign(new Error('login:fail'), options.loginError))
                  : Promise.resolve({ ...credential }),
    } as unknown as IPlatform;
    const auth = new AuthService({
        http,
        platform: () => platform,
        deviceId: () => 'dev1',
        lastUser: { get: () => last, set: (id) => (last = id) },
        onUser,
        onWarn,
        onRecovered,
        fallback: options.fallback ?? 'last-user',
        platformLoginTimeoutMs: 20,
        now: () => 1000,
    });
    http.configure({ tokenProvider: auth });
    return {
        auth,
        mock,
        http,
        onUser,
        onWarn,
        onRecovered,
        lastUser: () => last,
        setCredential: (c: LoginCredential) => (credential = c),
    };
}

const platformFailure = { errMsg: 'login:fail' };

describe('AuthService login', () => {
    it('logs in with the platform code and device id and stores the session', async () => {
        const s = setup();
        let sent: unknown;
        s.mock.on('POST', '/auth/login', ({ body, headers }) => {
            sent = { body, auth: headers.Authorization };
            return { body: { token: 'tok', refreshToken: 'ref', userId: 42, expiresIn: 60 } };
        });
        await expect(s.auth.login()).resolves.toEqual({ userId: '42', offline: false });
        expect(sent).toEqual({ body: { platform: 'wechat', deviceId: 'dev1', code: 'c' }, auth: undefined });
        expect(s.auth.session).toEqual({ token: 'tok', refreshToken: 'ref', userId: '42', expiresAt: 61000 });
        expect(s.auth.userId).toBe('42');
        expect(s.onUser).toHaveBeenCalledWith('42');
        expect(s.lastUser()).toBe('42');
    });

    it('reports the server time from the login response', async () => {
        const s = setup();
        const onServerTime = vi.fn();
        s.auth['options'].onServerTime = onServerTime;
        s.auth['options'].mark = () => 77;
        s.mock.on('POST', '/auth/login', () => ({ body: { token: 't', userId: 'u', expiresIn: 60, serverTime: 123 } }));
        await s.auth.login();
        expect(onServerTime).toHaveBeenCalledWith(123, 77);
    });

    it('uses the device id as anonymous code when the platform has no code', async () => {
        const s = setup({ credential: {} });
        await expect(s.auth.login()).resolves.toEqual({ userId: 'u-dev1', offline: false });
    });

    it('rejects responses without token or userId', async () => {
        const s = setup();
        s.mock.on('POST', '/auth/login', () => ({ body: { token: 'x' } }));
        await expect(s.auth.login()).rejects.toBeInstanceOf(HttpError);
    });

    it('rejects user ids containing a colon before switching saves', async () => {
        const s = setup({ lastUser: 'old' });
        s.mock.on('POST', '/auth/login', () => ({ body: { token: 'x', userId: 'wx:1', expiresIn: 60 } }));
        await expect(s.auth.login()).rejects.toMatchObject({ kind: 'parse' });
        expect(s.onUser).not.toHaveBeenCalled();
    });
});

describe('AuthService last-user fallback', () => {
    it('enters offline with the last user when the platform login fails', async () => {
        const s = setup({ lastUser: 'old', loginError: platformFailure });
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
        expect(s.onUser).toHaveBeenCalledWith('old');
        expect(s.auth.getToken()).toBeNull();
        expect(s.onWarn).toHaveBeenCalled();
    });

    it('enters offline with the last user on network errors', async () => {
        const s = setup({ lastUser: 'old' });
        s.http.configure({ transport: { send: () => Promise.reject(new HttpError('network', 'offline')) } });
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
    });

    it('enters offline with the last user on server errors', async () => {
        const s = setup({ lastUser: 'old' });
        s.mock.on('POST', '/auth/login', () => ({ status: 503 }));
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
    });

    it('enters offline with the last user on request timeout', async () => {
        const s = setup({ lastUser: 'old' });
        s.mock.on('POST', '/auth/login', () => ({ delayMs: 1000 }));
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
    });

    it('enters offline with the last user when the platform login never answers', async () => {
        const s = setup({ lastUser: 'old', loginHangs: true });
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
        expect(s.onUser).toHaveBeenCalledWith('old');
    });

    it('rejects a hanging platform login with aborted when cancelled', async () => {
        const s = setup({ lastUser: 'old', loginHangs: true });
        const cancel = new CancelSource();
        const pending = s.auth.login(cancel.signal);
        cancel.cancel();
        await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
        expect(s.onUser).not.toHaveBeenCalled();
    });

    it('fails the first login when offline', async () => {
        const s = setup({ loginError: platformFailure });
        await expect(s.auth.login()).rejects.toMatchObject({ errMsg: 'login:fail' });
    });

    it('does not enter offline on client errors, programming errors or cancellation', async () => {
        const s = setup({ lastUser: 'old' });
        s.mock.on('POST', '/auth/login', () => ({ status: 403 }));
        await expect(s.auth.login()).rejects.toMatchObject({ kind: 'http', status: 403 });
        s.mock.on('POST', '/auth/login', () => {
            throw new TypeError('bug');
        });
        await expect(s.auth.login()).rejects.toBeInstanceOf(TypeError);
        const cancel = new CancelSource();
        cancel.cancel();
        await expect(s.auth.login(cancel.signal)).rejects.toMatchObject({ kind: 'aborted' });
        expect(s.onUser).not.toHaveBeenCalled();
    });
});

describe('AuthService guest fallback', () => {
    it('enters as a device guest when the first login fails', async () => {
        const s = setup({ fallback: 'guest' });
        s.mock.on('POST', '/auth/login', () => ({ status: 404 }));
        await expect(s.auth.login()).resolves.toEqual({ userId: 'guest-dev1', offline: true });
        expect(s.onUser).toHaveBeenCalledWith('guest-dev1');
    });

    it('prefers the last user over the guest identity', async () => {
        const s = setup({ fallback: 'guest', lastUser: 'old', loginError: platformFailure });
        await expect(s.auth.login()).resolves.toEqual({ userId: 'old', offline: true });
    });

    it('still rethrows cancellation', async () => {
        const s = setup({ fallback: 'guest' });
        const cancel = new CancelSource();
        cancel.cancel();
        await expect(s.auth.login(cancel.signal)).rejects.toMatchObject({ kind: 'aborted' });
    });
});

describe('AuthService session recovery', () => {
    it('refreshes the token on 401 and retries the request', async () => {
        const s = setup();
        await s.auth.login();
        s.mock.on('POST', '/auth/refresh', ({ body }) => ({
            body: { token: `new-${(body as { refreshToken: string }).refreshToken}`, expiresIn: 60 },
        }));
        s.mock.on('GET', '/me', ({ headers }) =>
            headers.Authorization === 'Bearer new-r' ? { body: { ok: true } } : { status: 401 },
        );
        await expect(s.http.get('me')).resolves.toMatchObject({ data: { ok: true } });
        expect(s.auth.getToken()).toBe('new-r');
    });

    it('logs in again when refresh fails', async () => {
        const s = setup();
        await s.auth.login();
        s.mock.on('POST', '/auth/refresh', () => ({ status: 401 }));
        await expect(s.auth.refresh()).resolves.toBe('t2');
    });

    it('recovers a session on 401 after entering offline', async () => {
        const s = setup({ lastUser: 'u-c', loginError: undefined });
        const fail = s.mock;
        fail.on('POST', '/auth/login', () => ({ status: 503 }));
        await expect(s.auth.login()).resolves.toMatchObject({ offline: true });
        fail.on('POST', '/auth/login', () => ({
            body: { token: 'tok', refreshToken: 'r', userId: 'u-c', expiresIn: 60 },
        }));
        s.mock.on('GET', '/me', ({ headers }) => (headers.Authorization ? { body: { ok: true } } : { status: 401 }));
        await expect(s.http.get('me')).resolves.toMatchObject({ data: { ok: true } });
        expect(s.auth.session?.token).toBe('tok');
    });

    it('reports recovery once after an offline entry and not after an online login', async () => {
        const s = setup({ lastUser: 'old' });
        await s.auth.login();
        expect(s.auth.offline).toBe(false);
        await s.auth.refresh();
        expect(s.onRecovered).not.toHaveBeenCalled();
        s.mock.on('POST', '/auth/login', () => ({ status: 503 }));
        await expect(s.auth.login()).resolves.toMatchObject({ offline: true });
        expect(s.auth.offline).toBe(true);
        s.mock.on('POST', '/auth/login', () => ({
            body: { token: 'tok', refreshToken: 'r', userId: 'u-c', expiresIn: 60 },
        }));
        await expect(s.auth.reconnect()).resolves.toBe(true);
        expect(s.auth.offline).toBe(false);
        expect(s.onRecovered).toHaveBeenCalledWith('u-c');
        await s.auth.refresh();
        expect(s.onRecovered).toHaveBeenCalledTimes(1);
    });

    it('reconnects once while offline and keeps the save scope when the user differs', async () => {
        const s = setup({ lastUser: 'old' });
        s.mock.on('POST', '/auth/login', () => ({ status: 503 }));
        await s.auth.login();
        s.onUser.mockClear();
        let calls = 0;
        s.mock.on('POST', '/auth/login', () => {
            calls++;
            return { body: { token: 'tok', refreshToken: 'r', userId: 'other', expiresIn: 60 } };
        });
        const [a, b] = await Promise.all([s.auth.reconnect(), s.auth.reconnect()]);
        expect([a, b, calls]).toEqual([true, true, 1]);
        expect(s.onUser).not.toHaveBeenCalled();
        expect(s.auth.userId).toBe('old');
        expect(s.onWarn).toHaveBeenLastCalledWith(
            '登录用户与当前存档用户不一致，下次启动生效',
            expect.objectContaining({ active: 'old', userId: 'other' }),
        );
        expect(s.lastUser()).toBe('other');
        await expect(s.auth.reconnect()).resolves.toBe(true);
        expect(calls).toBe(1);
    });

    it('reports reconnect failure', async () => {
        const s = setup({ lastUser: 'old', loginError: platformFailure });
        await s.auth.login();
        await expect(s.auth.reconnect()).resolves.toBe(false);
    });

    it('does not switch saves when refresh logs in as another user', async () => {
        const s = setup();
        await s.auth.login();
        s.onUser.mockClear();
        s.setCredential({ code: 'other' });
        s.mock.on('POST', '/auth/refresh', () => ({ status: 401 }));
        await s.auth.refresh();
        expect(s.onUser).not.toHaveBeenCalled();
        expect(s.auth.userId).toBe('u-c');
    });

    it('returns null from refresh when login also fails', async () => {
        const s = setup({ loginError: platformFailure });
        await expect(s.auth.refresh()).resolves.toBeNull();
    });
});
