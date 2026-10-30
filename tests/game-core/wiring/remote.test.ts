import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted((): { data: unknown; cache: unknown } => ({ data: undefined, cache: null }));

vi.mock('db://game-core/config/env', () => ({
    getEnv: () => ({ version: '1.0.0', httpServer: 'https://api.test/' }),
}));
vi.mock('db://game-core/wiring/services', () => ({
    bootPipeline: { register: () => undefined },
    deviceSave: {
        slot: () => ({
            get: () => state.cache,
            set: (value: unknown) => {
                state.cache = value;
            },
        }),
    },
    http: { get: () => Promise.resolve({ data: state.data }) },
    platform: { name: 'web', getEnvVersion: () => 'develop' },
    remoteConfig: {},
}));

const { fetchRemoteConfig } = await import('db://game-core/wiring/remote');
const previous = { key: 'web|develop|1.0.0|https://api.test/', values: { reviewMode: true } };

beforeEach(() => {
    state.cache = previous;
});

describe('fetchRemoteConfig', () => {
    it('caches an object response', async () => {
        state.data = { shareReward: true };
        await expect(fetchRemoteConfig('config')).resolves.toEqual({ shareReward: true });
        expect(state.cache).toEqual({ key: previous.key, values: { shareReward: true } });
    });

    it('treats an empty response as no overrides', async () => {
        for (const data of [null, '']) {
            state.data = data;
            await expect(fetchRemoteConfig('config')).resolves.toEqual({});
        }
    });

    it('rejects an array or primitive response and keeps the previous cache', async () => {
        for (const data of [[1, 2], 'x', 3]) {
            state.data = data;
            await expect(fetchRemoteConfig('config')).rejects.toThrow('远程配置不是对象');
            expect(state.cache).toBe(previous);
        }
    });
});
