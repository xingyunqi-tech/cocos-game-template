import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchOptions } from 'db://game-core/platform/types';
import { isSidebarLaunch } from 'db://game-core/platform/utils';

const state = vi.hoisted(() => ({
    ready: false,
    show: { scene: '', query: {} },
    listeners: [] as Array<(options: LaunchOptions) => void>,
    readyListeners: [] as Array<() => void>,
}));

vi.mock('db://game-core/monitor/errors', () => ({ reportError: () => undefined }));
vi.mock('db://game-core/wiring/auth', () => ({
    isUserReady: () => state.ready,
    onUserReady: (listener: () => void) => {
        state.readyListeners.push(listener);
        return () => undefined;
    },
}));
vi.mock('db://game-core/wiring/services', () => ({
    onPlatformShow: (listener: (options: LaunchOptions) => void) => {
        state.listeners.push(listener);
        return () => (state.listeners = state.listeners.filter((l) => l !== listener));
    },
    platform: {
        getShowOptions: () => state.show,
        sidebar: { isLaunchedFromSidebar: (options: LaunchOptions) => isSidebarLaunch(options) },
    },
    serverTime: { today: () => '2026-10-28' },
    userSave: { slot: () => ({ get: () => ({ lastClaimDay: '' }), set: () => undefined }) },
}));

const { onSidebarLaunch, sidebarReward } = await import('db://game-core/wiring/sidebar');
const SIDEBAR: LaunchOptions = { scene: '021036', query: {} };
const show = (options: LaunchOptions) => {
    state.show = options;
    for (const listener of state.listeners.slice()) listener(options);
};
const becomeReady = () => {
    state.ready = true;
    for (const listener of state.readyListeners) listener();
};
const offs: Array<() => void> = [];

beforeEach(() => {
    for (const off of offs.splice(0)) off();
    state.ready = false;
    state.show = { scene: '', query: {} };
});

describe('onSidebarLaunch', () => {
    it('calls back once after the user is ready for sidebar returns before that, unless unsubscribed', () => {
        const kept = vi.fn();
        const dropped = vi.fn();
        offs.push(onSidebarLaunch(kept));
        const off = onSidebarLaunch(dropped);
        show(SIDEBAR);
        show(SIDEBAR);
        off();
        expect(kept).not.toHaveBeenCalled();
        expect(sidebarReward.canClaim()).toBe(false);
        becomeReady();
        expect(kept).toHaveBeenCalledTimes(1);
        expect(dropped).not.toHaveBeenCalled();
    });

    it('calls back immediately for a sidebar return after the user is ready', () => {
        state.ready = true;
        const listener = vi.fn();
        offs.push(onSidebarLaunch(listener));
        show({ scene: '1001', query: {} });
        show(SIDEBAR);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
