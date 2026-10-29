import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
    data: undefined as Record<string, unknown> | undefined,
    raw: { type: 'staging', config: { dev: {} } },
}));
const memory = vi.hoisted(() => new Map<string, string>());

vi.mock('cc', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    sys: {
        localStorage: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => memory.set(key, value),
            removeItem: (key: string) => memory.delete(key),
        },
    },
}));
vi.mock('db://oops-framework/core/Oops', () => ({
    oops: {
        config: {
            game: {
                get data() {
                    return config.data;
                },
                _data: config.raw,
                setConfigType: () => undefined,
            },
        },
    },
}));
vi.mock('db://oops-framework/core/common/event/EventMessage', () => ({
    EventMessage: { GAME_SHOW: 'show', GAME_HIDE: 'hide' },
}));
vi.mock('db://game-core/config/Bundles', () => ({
    assertReleasable: () => undefined,
    unloadBundle: () => true,
}));
vi.mock('db://game-core/ui/kit', () => ({
    setButtonClickHook: () => undefined,
    visibleSize: () => ({ width: 750, height: 1334 }),
}));
vi.mock('db://game-core/ui/ConfirmDialog', () => ({ showConfirm: () => Promise.resolve(true) }));
vi.mock('db://game-core/ui/SafeTopAdapter', () => ({ setSafeTopProvider: () => undefined }));
vi.mock('db://game-core/compliance/HealthNotice', () => ({ HealthNotice: class {} }));
vi.mock('db://game-core/debug/GmPanel', () => ({ installGmButton: () => undefined }));
vi.mock('db://game-core/wiring/ui', () => ({
    coreUi: {},
    createPrivacyPrompt: () => undefined,
    defaultPrivacyPrompt: undefined,
    offlineBanner: { update: () => undefined },
    privacy: {},
}));

const { initGameCore } = await import('db://game-core/core');
const { platform } = await import('db://game-core/wiring/services');

describe('initGameCore', () => {
    it('throws on a config type without environment data and rethrows a failed setup without running it again', () => {
        expect(() => initGameCore()).toThrow('config.json 的 type「staging」没有对应的环境配置');

        config.data = { version: '1.0.0', httpServer: '', httpTimeout: 1000, httpMock: false, logLevel: 'warn' };
        const hooks = vi.spyOn(platform, 'installErrorHooks').mockImplementationOnce(() => {
            throw new Error('hook failed');
        });
        expect(() => initGameCore()).toThrow('hook failed');
        expect(() => initGameCore()).toThrow('hook failed');
        expect(hooks).toHaveBeenCalledTimes(1);
    });
});
