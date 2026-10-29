import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchOptions } from 'db://game-core/platform/types';
import { isSidebarLaunch } from 'db://game-core/platform/utils';

const state = vi.hoisted(() => ({
    hasScope: false,
    show: { scene: '', query: {} },
    listeners: [] as Array<(options: LaunchOptions) => void>,
}));

vi.mock('db://game-core/monitor/errors', () => ({ reportError: () => undefined }));
vi.mock('db://game-core/wiring/services', () => ({
    platform: {
        getShowOptions: () => state.show,
        onShow: (listener: (options: LaunchOptions) => void) => {
            state.listeners.push(listener);
            return () => (state.listeners = state.listeners.filter((l) => l !== listener));
        },
        sidebar: { isLaunchedFromSidebar: (options: LaunchOptions) => isSidebarLaunch(options) },
    },
    serverTime: { today: () => '2026-10-28' },
    userSave: {
        get hasScope() {
            return state.hasScope;
        },
        slot: () => ({ get: () => ({ lastClaimDay: '' }), set: () => undefined }),
    },
}));

const { onSidebarLaunch, flushSidebarListeners } = await import('db://game-core/wiring/sidebar');
const SIDEBAR = { scene: '021036', query: {} } as LaunchOptions;
const show = (options: LaunchOptions) => {
    state.show = options;
    for (const listener of state.listeners.slice()) listener(options);
};

beforeEach(() => {
    state.hasScope = false;
    state.show = { scene: '', query: {} };
    flushSidebarListeners();
});

describe('onSidebarLaunch', () => {
    it('calls back after login for a sidebar return before login', () => {
        const listener = vi.fn();
        const off = onSidebarLaunch(listener);
        show(SIDEBAR);
        show(SIDEBAR);
        expect(listener).not.toHaveBeenCalled();
        state.hasScope = true;
        flushSidebarListeners();
        expect(listener).toHaveBeenCalledTimes(1);
        off();
    });

    it('calls back immediately for a sidebar return after login', () => {
        state.hasScope = true;
        const listener = vi.fn();
        const off = onSidebarLaunch(listener);
        show({ scene: '1001', query: {} });
        show(SIDEBAR);
        expect(listener).toHaveBeenCalledTimes(1);
        off();
    });

    it('drops a pending callback after unsubscribing', () => {
        const listener = vi.fn();
        const off = onSidebarLaunch(listener);
        show(SIDEBAR);
        off();
        state.hasScope = true;
        flushSidebarListeners();
        expect(listener).not.toHaveBeenCalled();
    });
});
