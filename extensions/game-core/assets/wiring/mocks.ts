import type { MockTransport } from '../net/MockTransport';

/** config.json 的 httpMock 为 true 时注册的内置接口 */
export function registerCoreMocks(mock: MockTransport) {
    mock.on('POST', '/auth/login', ({ body }) => {
        const { deviceId, anonymousCode } = (body ?? {}) as { deviceId?: string; anonymousCode?: string };
        const id = (deviceId ?? anonymousCode ?? 'guest').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        return {
            body: {
                token: `mock-token-${id}`,
                refreshToken: `mock-refresh-${id}`,
                userId: `mock-${id}`,
                expiresIn: 7200,
                serverTime: Date.now(),
            },
        };
    });
    mock.on('POST', '/auth/refresh', ({ body }) => {
        const { refreshToken = '' } = (body ?? {}) as { refreshToken?: string };
        if (!refreshToken.startsWith('mock-refresh-')) return { status: 401 };
        return { body: { token: `mock-token-${refreshToken.slice(13)}-${Date.now()}`, expiresIn: 7200 } };
    });
    mock.on('GET', '/config', () => ({ body: {} }));
    mock.on('POST', '/track', () => ({ body: { ok: true } }));
}
