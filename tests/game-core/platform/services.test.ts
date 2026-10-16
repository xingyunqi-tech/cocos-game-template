import { describe, expect, it, vi } from 'vitest';
import { AppUpdate } from 'db://game-core/platform/AppUpdate';
import { NetworkStatus } from 'db://game-core/platform/NetworkStatus';
import type { IPlatform, NetworkType } from 'db://game-core/platform/types';

function platformStub(initial: NetworkType) {
    let change: ((online: boolean, type: NetworkType) => void) | undefined;
    let ready: (() => void) | undefined;
    let failed: (() => void) | undefined;
    let resolveType!: (t: NetworkType) => void;
    const stub = {
        getNetworkType: () => new Promise<NetworkType>((resolve) => (resolveType = resolve)),
        onNetworkChange: (l: typeof change) => {
            change = l;
            return () => (change = undefined);
        },
        onUpdateReady: (l: () => void) => {
            ready = l;
            return () => undefined;
        },
        onUpdateFailed: (l: () => void) => {
            failed = l;
            return () => undefined;
        },
        applyUpdate: vi.fn(),
    };
    return {
        platform: stub as unknown as IPlatform,
        stub,
        resolveInitial: () => resolveType(initial),
        change: (online: boolean, type: NetworkType) => change?.(online, type),
        ready: () => ready?.(),
        failed: () => failed?.(),
        hasListener: () => change !== undefined,
    };
}

describe('NetworkStatus', () => {
    it('notifies only when the online state flips', async () => {
        const s = platformStub('wifi');
        const status = new NetworkStatus();
        const listener = vi.fn();
        status.onChange(listener);
        const started = status.start(s.platform);
        s.resolveInitial();
        await started;
        expect(status.online).toBe(true);
        s.change(true, '4g');
        s.change(false, 'none');
        s.change(false, 'none');
        s.change(true, 'wifi');
        expect(listener.mock.calls).toEqual([
            [false, 'none'],
            [true, 'wifi'],
        ]);
        expect(status.type).toBe('wifi');
    });

    it('starts offline when the initial type is none', async () => {
        const s = platformStub('none');
        const status = new NetworkStatus();
        const started = status.start(s.platform);
        s.resolveInitial();
        await started;
        expect(status.online).toBe(false);
    });

    it('prefers change events that arrive before the initial query resolves', async () => {
        const s = platformStub('none');
        const status = new NetworkStatus();
        const started = status.start(s.platform);
        s.change(true, 'wifi');
        s.resolveInitial();
        await started;
        expect(status.online).toBe(true);
    });

    it('stops listening on dispose', async () => {
        const s = platformStub('wifi');
        const status = new NetworkStatus();
        const started = status.start(s.platform);
        s.resolveInitial();
        await started;
        status.dispose();
        expect(s.hasListener()).toBe(false);
    });
});

describe('AppUpdate', () => {
    it('applies only after the update is ready', () => {
        const s = platformStub('wifi');
        const update = new AppUpdate();
        update.bind(s.platform);
        const listener = vi.fn();
        update.onReady(listener);
        expect(update.apply()).toBe(false);
        s.ready();
        s.ready();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(update.apply()).toBe(true);
        expect(s.stub.applyUpdate).toHaveBeenCalled();
    });

    it('notifies download failures', () => {
        const s = platformStub('wifi');
        const update = new AppUpdate();
        update.bind(s.platform);
        const listener = vi.fn();
        update.onFailed(listener);
        s.failed();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(update.apply()).toBe(false);
    });

    it('calls late listeners immediately', () => {
        const s = platformStub('wifi');
        const update = new AppUpdate();
        update.bind(s.platform);
        s.ready();
        const listener = vi.fn();
        update.onReady(listener);
        expect(listener).toHaveBeenCalled();
    });
});
