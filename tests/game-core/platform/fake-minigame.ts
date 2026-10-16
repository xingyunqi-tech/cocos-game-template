import { vi } from 'vitest';
import type { ApiError, Callbacks, MiniGameApi } from 'db://game-core/platform/impl/minigame-api';

type Listener = (...args: unknown[]) => void;

const apiError = (err: ApiError) => Object.assign(new Error(err.errMsg ?? 'fail'), err);

export class FakeAd {
    readonly listeners: Record<string, Listener[]> = { close: [] };
    showResults: Array<'ok' | ApiError> = ['ok'];
    loadResult: 'ok' | ApiError = 'ok';
    destroyed = false;
    showCalls = 0;
    loadCalls = 0;

    show = () => {
        this.showCalls++;
        const next = this.showResults.shift() ?? 'ok';
        return next === 'ok' ? Promise.resolve() : Promise.reject(apiError(next));
    };
    load = () => {
        this.loadCalls++;
        return this.loadResult === 'ok' ? Promise.resolve() : Promise.reject(apiError(this.loadResult));
    };
    onClose = (l: Listener) => this.listeners.close.push(l);
    offClose = (l: Listener) => (this.listeners.close = this.listeners.close.filter((x) => x !== l));
    onError = vi.fn();
    offError = vi.fn();
    destroy = () => {
        this.destroyed = true;
    };
    close(res?: unknown) {
        for (const l of this.listeners.close.slice()) l(res);
    }
}

function succeed<T>(value: T) {
    return (options: Callbacks<T>) => options.success?.(value);
}

export function fakeApi(overrides: Record<string, unknown> = {}) {
    const showListeners: Listener[] = [];
    const networkListeners: Listener[] = [];
    const ads: FakeAd[] = [];
    const api = {
        login: vi.fn(succeed({ code: 'c1' })),
        checkSession: vi.fn(succeed({})),
        getLaunchOptionsSync: () => ({ scene: 1001, query: { a: '1' } }),
        onShow: (l: Listener) => showListeners.push(l),
        shareAppMessage: vi.fn(succeed({})),
        showShareMenu: vi.fn(),
        onShareAppMessage: vi.fn(),
        getSystemInfoSync: () => ({
            platform: 'iOS',
            SDKVersion: '3.0.0',
            windowWidth: 375,
            windowHeight: 812,
            statusBarHeight: 44,
            safeArea: { left: 0, top: 47, right: 375, bottom: 778, width: 375, height: 731 },
        }),
        getNetworkType: succeed({ networkType: 'wifi' }),
        onNetworkStatusChange: (l: Listener) => networkListeners.push(l),
        offNetworkStatusChange: (l: Listener) => networkListeners.splice(networkListeners.indexOf(l), 1),
        vibrateShort: vi.fn(),
        vibrateLong: vi.fn(),
        setClipboardData: vi.fn(succeed({})),
        getStorageInfoSync: () => ({ currentSize: 9000, limitSize: 10240 }),
        createRewardedVideoAd: vi.fn(() => {
            const ad = new FakeAd();
            ads.push(ad);
            return ad;
        }),
        createInterstitialAd: vi.fn(() => {
            const ad = new FakeAd();
            ads.push(ad);
            return ad;
        }),
        ...overrides,
    };
    return {
        api,
        ads,
        emitShow: (res: unknown) => showListeners.forEach((l) => l(res)),
        emitNetwork: (res: unknown) => networkListeners.slice().forEach((l) => l(res)),
        networkListeners,
    };
}

export function setGlobal(name: 'wx' | 'tt', value: unknown) {
    (globalThis as Record<string, unknown>)[name] = value;
}

export function asApi(api: object): MiniGameApi {
    return api as MiniGameApi;
}
