import { describe, expect, it, vi } from 'vitest';
import { ErrorReporter, type ErrorReport } from 'db://game-core/monitor/errors';
import { WebPlatform, type WebHost } from 'db://game-core/platform/impl/web';

function host(extra: Partial<WebHost> = {}) {
    const target = new EventTarget();
    return {
        location: { search: '?from=ad&x=1', href: 'https://game.test/index.html?from=ad' },
        navigator: { onLine: true },
        innerWidth: 720,
        innerHeight: 1280,
        devicePixelRatio: 2,
        addEventListener: (type: string, listener: (event: unknown) => void) => target.addEventListener(type, listener),
        removeEventListener: (type: string, listener: (event: unknown) => void) =>
            target.removeEventListener(type, listener),
        dispatch: (type: string) => target.dispatchEvent(new Event(type)),
        ...extra,
    };
}

describe('WebPlatform', () => {
    it('parses launch query from location', () => {
        const platform = new WebPlatform(host(), { debug: true });
        expect(platform.getLaunchOptions()).toEqual({ scene: '', query: { from: 'ad', x: '1' } });
        expect(platform.getShowOptions()).toBe(platform.getLaunchOptions());
    });

    it('returns an empty credential and no sidebar', async () => {
        const platform = new WebPlatform(host(), { debug: true });
        await expect(platform.login()).resolves.toEqual({});
        await expect(platform.sidebar.isSupported()).resolves.toBe(false);
        expect(platform.sidebar.isLaunchedFromSidebar({ scene: '021036', query: {} })).toBe(false);
    });

    it('simulates ads in debug and fails them in release', async () => {
        const debug = new WebPlatform(host(), { debug: true });
        await expect(debug.ads.showRewarded()).resolves.toEqual({ result: 'completed' });
        await expect(debug.ads.showInterstitial()).resolves.toEqual({ result: 'shown' });
        debug.ads.mode = 'skipped';
        await expect(debug.ads.showRewarded()).resolves.toEqual({ result: 'skipped' });
        const release = new WebPlatform(host(), { debug: false });
        await expect(release.ads.showRewarded()).resolves.toEqual({ result: 'failed', reason: 'unsupported' });
        expect(release.getEnvVersion()).toBe('release');
        expect(debug.getEnvVersion()).toBe('develop');
    });

    it('tracks online and offline events', async () => {
        const h = host({ navigator: { onLine: false } });
        const platform = new WebPlatform(h, { debug: true });
        await expect(platform.getNetworkType()).resolves.toBe('none');
        const listener = vi.fn();
        const off = platform.onNetworkChange(listener);
        h.dispatch('offline');
        h.dispatch('online');
        off();
        h.dispatch('offline');
        expect(listener.mock.calls).toEqual([
            [false, 'none'],
            [true, 'unknown'],
        ]);
    });

    it('shares through navigator.share when available', async () => {
        const share = vi.fn(() => Promise.resolve());
        const platform = new WebPlatform(host({ navigator: { share } }), { debug: true });
        await expect(platform.share({ title: 't', query: 'a=1' })).resolves.toBe('success');
        expect(share).toHaveBeenCalledWith({ title: 't', url: 'https://game.test/index.html?a=1' });
        await expect(new WebPlatform(host(), { debug: true }).share({})).resolves.toBe('fail');
    });

    it('writes clipboard when available', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        await expect(
            new WebPlatform(host({ navigator: { clipboard: { writeText } } }), { debug: true }).setClipboard('x'),
        ).resolves.toBe(true);
        await expect(new WebPlatform(host(), { debug: true }).setClipboard('x')).resolves.toBe(false);
    });

    it('installs window error hooks', () => {
        const h = host();
        const platform = new WebPlatform(h, { debug: true });
        const reporter = new ErrorReporter();
        const reports: ErrorReport[] = [];
        reporter.addSink((r) => reports.push(r));
        const uninstall = platform.installErrorHooks(reporter);
        h.dispatch('unhandledrejection');
        uninstall();
        h.dispatch('unhandledrejection');
        expect(reports).toHaveLength(1);
        expect(reports[0].source).toBe('promise');
    });

    it('reports defaults for unsupported capabilities', async () => {
        const platform = new WebPlatform(host(), { debug: true });
        expect(platform.getTopInset()).toEqual({ safeTop: 0 });
        expect(platform.getStorageUsage()).toBeNull();
        expect(platform.monotonicNow()).toBeNull();
        expect(new WebPlatform(host({ performance: { now: () => 123 } }), { debug: true }).monotonicNow()).toBe(123);
        expect(platform.onNeedPrivacyAuthorization()).toBe(false);
        await expect(platform.getPrivacySetting()).resolves.toEqual({ supported: false, needAuthorization: false });
        expect(platform.getSystemInfo()).toMatchObject({ os: 'web', windowWidth: 720, pixelRatio: 2 });
    });
});
