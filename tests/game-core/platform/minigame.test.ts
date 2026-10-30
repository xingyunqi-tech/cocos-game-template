import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorReporter, type ErrorReport } from 'db://game-core/monitor/errors';
import { DouyinPlatform, DouyinRecorder } from 'db://game-core/platform/impl/douyin';
import { MiniGameAdProvider } from 'db://game-core/platform/impl/minigame';
import { WechatPlatform } from 'db://game-core/platform/impl/wechat';
import { asApi, FakeAd, fakeApi, setGlobal } from './fake-minigame';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let created: FakeAd[] = [];

function presetAd(preset: Partial<Pick<FakeAd, 'showResults' | 'loadResult'>>) {
    const ad = Object.assign(new FakeAd(), preset);
    created.push(ad);
    return ad;
}

afterEach(() => {
    created = [];
    setGlobal('wx', undefined);
    setGlobal('tt', undefined);
});

function wechat(overrides: Record<string, unknown> = {}) {
    const fake = fakeApi(overrides);
    setGlobal('wx', fake.api);
    return { ...fake, platform: new WechatPlatform() };
}

function douyin(overrides: Record<string, unknown> = {}) {
    const fake = fakeApi({ navigateToScene: vi.fn((o: { success: () => void }) => o.success()), ...overrides });
    setGlobal('tt', fake.api);
    return { ...fake, platform: new DouyinPlatform() };
}

describe('MiniGamePlatform common behavior', () => {
    it('logs in without forcing authorization', async () => {
        const { api, platform } = douyin({
            login: vi.fn((o: { success: (r: unknown) => void }) =>
                o.success({ anonymousCode: 'anon', isLogin: false }),
            ),
        });
        await expect(platform.login()).resolves.toEqual({ anonymousCode: 'anon' });
        expect(api.login.mock.calls[0][0]).toMatchObject({ force: false });
    });

    it('rejects login when the platform call fails', async () => {
        const { platform } = wechat({ login: (o: { fail: (e: unknown) => void }) => o.fail({ errMsg: 'login:fail' }) });
        await expect(platform.login()).rejects.toMatchObject({ errMsg: 'login:fail' });
    });

    it('maps checkSession to a boolean', async () => {
        const { platform } = wechat({ checkSession: (o: { fail: (e: unknown) => void }) => o.fail({}) });
        await expect(platform.checkSession()).resolves.toBe(false);
    });

    it('tracks the latest onShow options registered at construction', () => {
        const { platform, emitShow } = douyin();
        const seen: string[] = [];
        platform.onShow((o) => seen.push(o.scene));
        expect(platform.getShowOptions()).toEqual({ scene: '1001', query: { a: '1' } });
        emitShow({ scene: '021036', query: {}, launch_from: 'homepage', location: 'sidebar_card' });
        expect(platform.getShowOptions().scene).toBe('021036');
        expect(platform.getLaunchOptions().scene).toBe('1001');
        expect(seen).toEqual(['021036']);
    });

    it('reports network changes and unsubscribes', async () => {
        const { platform, emitNetwork, networkListeners } = wechat();
        await expect(platform.getNetworkType()).resolves.toBe('wifi');
        const listener = vi.fn();
        const off = platform.onNetworkChange(listener);
        emitNetwork({ isConnected: false, networkType: 'none' });
        expect(listener).toHaveBeenCalledWith(false, 'none');
        off();
        expect(networkListeners).toHaveLength(0);
    });

    it('swallows vibrate exceptions', () => {
        const { platform } = wechat({
            vibrateShort: () => {
                throw new Error('no');
            },
        });
        expect(() => platform.vibrate('short')).not.toThrow();
    });

    it('reports platform errors, rejections and memory warnings', () => {
        const hooks: Record<string, (res: unknown) => void> = {};
        const { platform } = wechat({
            onError: (l: (res: unknown) => void) => (hooks.error = l),
            onUnhandledRejection: (l: (res: unknown) => void) => (hooks.rejection = l),
            onMemoryWarning: (l: (res: unknown) => void) => (hooks.memory = l),
            offError: vi.fn(),
        });
        const reporter = new ErrorReporter();
        const reports: ErrorReport[] = [];
        reporter.addSink((r) => reports.push(r));
        platform.installErrorHooks(reporter);
        hooks.error({ message: 'boom', stack: 'at x' });
        hooks.rejection({ reason: new Error('nope') });
        hooks.memory({ level: 10 });
        expect(reports.map((r) => [r.source, r.message])).toEqual([
            ['global', 'boom'],
            ['promise', 'nope'],
            ['memory', '内存告警'],
        ]);
        expect(reports[0].stack).toBe('at x');
        expect(reports[2].context).toMatchObject({ level: 10 });
    });

    it('reads storage usage', () => {
        expect(wechat().platform.getStorageUsage()).toEqual({ currentKB: 9000, limitKB: 10240 });
        expect(wechat({ getStorageInfoSync: undefined }).platform.getStorageUsage()).toBeNull();
    });

    it('reads a monotonic clock in milliseconds from getPerformance', () => {
        const micro = wechat({ getPerformance: () => ({ now: () => Date.now() * 1000 }) }).platform;
        expect(Math.abs(micro.monotonicNow()! - Date.now())).toBeLessThan(50);
        const milli = douyin({ getPerformance: () => ({ now: () => Date.now() }) }).platform;
        expect(Math.abs(milli.monotonicNow()! - Date.now())).toBeLessThan(50);
        expect(wechat().platform.monotonicNow()).toBeNull();
        expect(wechat({ getPerformance: () => ({ now: () => 0 }) }).platform.monotonicNow()).toBeNull();
    });

    it('forwards update ready and apply', () => {
        let ready: (() => void) | undefined;
        const manager = { onUpdateReady: (l: () => void) => (ready = l), applyUpdate: vi.fn() };
        const { platform } = wechat({ getUpdateManager: () => manager });
        const listener = vi.fn();
        platform.onUpdateReady(listener);
        ready?.();
        expect(listener).toHaveBeenCalled();
        platform.applyUpdate();
        expect(manager.applyUpdate).toHaveBeenCalled();
    });

    it('dispatches update failures and supports unsubscribing', () => {
        let failed: (() => void) | undefined;
        const manager = {
            onUpdateReady: vi.fn(),
            onUpdateFailed: (l: () => void) => (failed = l),
            applyUpdate: vi.fn(),
        };
        const { platform } = wechat({ getUpdateManager: () => manager });
        const listener = vi.fn();
        const off = platform.onUpdateFailed(listener);
        failed?.();
        off();
        failed?.();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(manager.onUpdateReady).toHaveBeenCalledTimes(1);
    });
});

describe('WechatPlatform', () => {
    it('uses split system info APIs when available', () => {
        const { platform } = wechat({
            getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 47, pixelRatio: 3 }),
            getDeviceInfo: () => ({ platform: 'android', model: 'X', system: 'Android 14' }),
            getAppBaseInfo: () => ({ SDKVersion: '3.5.0', version: '8.0.50' }),
        });
        expect(platform.getSystemInfo()).toMatchObject({
            os: 'android',
            model: 'X',
            sdkVersion: '3.5.0',
            hostVersion: '8.0.50',
            windowWidth: 390,
            pixelRatio: 3,
        });
    });

    it('returns safe top and capsule rect', () => {
        const { platform } = wechat({
            getMenuButtonBoundingClientRect: () => ({
                left: 281,
                top: 51,
                right: 368,
                bottom: 83,
                width: 87,
                height: 32,
            }),
        });
        expect(platform.getTopInset()).toEqual({
            safeTop: 47,
            menuRect: { left: 281, top: 51, width: 87, height: 32 },
        });
    });

    it('returns unknown for share and registers timeline share', async () => {
        const onShareTimeline = vi.fn();
        const { api, platform } = wechat({ onShareTimeline });
        await expect(platform.share({ title: 't' })).resolves.toBe('unknown');
        expect(api.shareAppMessage).toHaveBeenCalledWith({ title: 't' });
        platform.setShareMenu({ title: 'm', query: 'a=1' });
        expect(api.showShareMenu).toHaveBeenCalled();
        expect(onShareTimeline).toHaveBeenCalled();
    });

    it('reads env version', () => {
        expect(
            wechat({ getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) }).platform.getEnvVersion(),
        ).toBe('trial');
        expect(wechat().platform.getEnvVersion()).toBe('release');
    });

    it('wraps privacy APIs when available', async () => {
        const plain = wechat().platform;
        await expect(plain.getPrivacySetting()).resolves.toEqual({ supported: false, needAuthorization: false });
        expect(plain.onNeedPrivacyAuthorization(vi.fn())).toBe(false);

        let need: ((resolve: (r: unknown) => void) => void) | undefined;
        const { platform } = wechat({
            getPrivacySetting: (o: { success: (r: unknown) => void }) => o.success({ needAuthorization: true }),
            openPrivacyContract: (o: { success: () => void }) => o.success(),
            onNeedPrivacyAuthorization: (l: typeof need) => (need = l),
        });
        await expect(platform.getPrivacySetting()).resolves.toEqual({ supported: true, needAuthorization: true });
        await expect(platform.openPrivacyContract()).resolves.toBe(true);
        expect(platform.onNeedPrivacyAuthorization((resolve) => resolve(false))).toBe(true);
        const resolve = vi.fn();
        need?.(resolve);
        expect(resolve).toHaveBeenCalledWith({ event: 'disagree' });
    });

    it('reports exposure and treats a failed privacy query as needing authorization', async () => {
        let need: ((resolve: (r: unknown) => void) => void) | undefined;
        const { platform } = wechat({
            getPrivacySetting: (o: { fail: (e: unknown) => void }) => o.fail({ errMsg: 'fail' }),
            onNeedPrivacyAuthorization: (l: typeof need) => (need = l),
        });
        await expect(platform.getPrivacySetting()).resolves.toEqual({ supported: true, needAuthorization: true });
        platform.onNeedPrivacyAuthorization((resolve, exposed) => {
            exposed();
            resolve(true);
        });
        const resolve = vi.fn();
        need?.(resolve);
        expect(resolve.mock.calls).toEqual([[{ event: 'exposureAuthorization' }], [{ event: 'agree' }]]);
    });

    it('replaces share listeners when the share menu is set again', () => {
        const offShareAppMessage = vi.fn();
        const offShareTimeline = vi.fn();
        const { api, platform } = wechat({ offShareAppMessage, onShareTimeline: vi.fn(), offShareTimeline });
        platform.setShareMenu({ title: 'a' });
        platform.setShareMenu({ title: 'b' });
        const listeners = api.onShareAppMessage.mock.calls.map((c) => c[0] as () => unknown);
        expect(offShareAppMessage).toHaveBeenCalledWith(listeners[0]);
        expect(offShareTimeline).toHaveBeenCalledTimes(1);
        expect(listeners[1]()).toEqual({ title: 'b' });
    });

    it('uses the larger of status bar height and safe area top', () => {
        const { platform } = wechat({ getWindowInfo: () => ({ statusBarHeight: 30, safeArea: { top: 0 } }) });
        expect(platform.getTopInset().safeTop).toBe(30);
    });
});

describe('WechatPlatform privacy authorization', () => {
    it('requires authorization through wx.requirePrivacyAuthorize', async () => {
        let ok = true;
        const requirePrivacyAuthorize = vi.fn((o: { success: () => void; fail: (e: unknown) => void }) =>
            ok ? o.success() : o.fail({ errMsg: 'requirePrivacyAuthorize:fail' }),
        );
        const { platform } = wechat({ requirePrivacyAuthorize });
        await expect(platform.requirePrivacyAuthorize()).resolves.toBe(true);
        ok = false;
        await expect(platform.requirePrivacyAuthorize()).resolves.toBe(false);
        const old = wechat().platform;
        await expect(old.requirePrivacyAuthorize()).resolves.toBe(true);
    });
});

describe('DouyinPlatform', () => {
    it('uses getMenuButtonLayout for the capsule rect', () => {
        const { platform } = douyin({
            getMenuButtonLayout: () => ({ left: 280, top: 50, right: 367, bottom: 82, width: 87, height: 32 }),
        });
        expect(platform.getTopInset()).toEqual({
            safeTop: 47,
            menuRect: { left: 280, top: 50, width: 87, height: 32 },
        });
    });

    it('maps env types', () => {
        const { platform } = douyin({ getEnvInfoSync: () => ({ microapp: { envType: 'preview' } }) });
        expect(platform.getEnvVersion()).toBe('trial');
    });

    it('reports share success and failure', async () => {
        await expect(douyin().platform.share({ title: 't' })).resolves.toBe('success');
        const failing = douyin({ shareAppMessage: (o: { fail: (e: unknown) => void }) => o.fail({}) });
        await expect(failing.platform.share({})).resolves.toBe('fail');
    });

    it('degrades privacy setting and gates the privacy listener by SDK version', async () => {
        const register = vi.fn();
        const old = douyin({ onNeedPrivacyAuthorization: register });
        await expect(old.platform.getPrivacySetting()).resolves.toEqual({ supported: false, needAuthorization: false });
        await expect(old.platform.openPrivacyContract()).resolves.toBe(false);
        expect(old.platform.onNeedPrivacyAuthorization(vi.fn())).toBe(false);
        expect(register).not.toHaveBeenCalled();

        const modern = douyin({
            onNeedPrivacyAuthorization: register,
            getSystemInfoSync: () => ({ SDKVersion: '4.17.0' }),
        });
        expect(modern.platform.onNeedPrivacyAuthorization((resolve) => resolve(true))).toBe(true);
        const resolve = vi.fn();
        (register.mock.calls[0][0] as (r: unknown) => void)(resolve);
        expect(resolve).toHaveBeenCalledWith({ event: 'agree' });
    });

    it('checks and opens the sidebar scene', async () => {
        const { api, platform } = douyin({
            checkScene: (o: { scene: string; success: (r: unknown) => void }) =>
                o.success({ isExist: o.scene === 'sidebar' }),
        });
        await expect(platform.sidebar.isSupported()).resolves.toBe(true);
        await expect(platform.sidebar.open()).resolves.toBe(true);
        expect(
            (api as unknown as { navigateToScene: ReturnType<typeof vi.fn> }).navigateToScene.mock.calls[0][0],
        ).toMatchObject({
            scene: 'sidebar',
        });
    });

    it('treats missing checkScene or failures as unsupported', async () => {
        await expect(douyin().platform.sidebar.isSupported()).resolves.toBe(false);
        const failing = douyin({ navigateToScene: (o: { fail: (e: unknown) => void }) => o.fail({ errNo: 21101 }) });
        await expect(failing.platform.sidebar.open()).resolves.toBe(false);
    });
});

describe('MiniGameAdProvider', () => {
    it('resolves completed or skipped from onClose', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false });
        const first = provider.showRewarded('u1');
        await flush();
        ads[0].close({ isEnded: true });
        await expect(first).resolves.toEqual({ result: 'completed' });
        const second = provider.showRewarded('u1');
        await flush();
        ads[0].close({ isEnded: false });
        await expect(second).resolves.toEqual({ result: 'skipped' });
        expect(api.createRewardedVideoAd).toHaveBeenCalledTimes(1);
        expect(ads[0].listeners.close).toHaveLength(0);
    });

    it('ends an unsettled show as failed when the same ad is shown again', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false });
        const first = provider.showRewarded('u1');
        await flush();
        const second = provider.showRewarded('u1');
        await expect(first).resolves.toMatchObject({ result: 'failed', reason: 'show_failed' });
        await flush();
        expect(ads[0].listeners.close).toHaveLength(1);
        ads[0].close({ isEnded: true });
        await expect(second).resolves.toEqual({ result: 'completed' });
    });

    it('stops the retry of a superseded show', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false });
        provider.preloadRewarded('u1');
        let finishLoad: () => void = () => undefined;
        ads[0].showResults = [{ errMsg: 'not ready' }];
        ads[0].load = () => new Promise<void>((resolve) => (finishLoad = resolve));
        const first = provider.showRewarded('u1');
        await flush();
        const second = provider.showRewarded('u1');
        await expect(first).resolves.toMatchObject({ result: 'failed' });
        finishLoad();
        await flush();
        expect(ads[0].showCalls).toBe(2);
        ads[0].close({ isEnded: true });
        await expect(second).resolves.toEqual({ result: 'completed' });
    });

    it('keeps the interstitial instance when an unsettled show is superseded', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: true });
        const first = provider.showInterstitial('u1');
        await flush();
        const second = provider.showInterstitial('u1');
        await expect(first).resolves.toMatchObject({ result: 'failed' });
        expect(ads[0].destroyed).toBe(false);
        await flush();
        ads[0].close();
        await expect(second).resolves.toEqual({ result: 'shown' });
        expect(ads[0].destroyed).toBe(true);
    });

    it('preloads a rewarded ad once and reuses it when shown', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false });
        provider.preloadRewarded('u1');
        provider.preloadRewarded('u1');
        expect(api.createRewardedVideoAd).toHaveBeenCalledTimes(1);
        expect(ads[0].loadCalls).toBe(1);
        const pending = provider.showRewarded('u1');
        await flush();
        ads[0].close({ isEnded: true });
        await expect(pending).resolves.toEqual({ result: 'completed' });
        expect(api.createRewardedVideoAd).toHaveBeenCalledTimes(1);
    });

    it('treats a missing close result as completed', async () => {
        const { api, ads } = fakeApi();
        const pending = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false }).showRewarded('u1');
        await flush();
        ads[0].close();
        await expect(pending).resolves.toEqual({ result: 'completed' });
    });

    it('reloads once when show fails, then shows again', async () => {
        const { api } = fakeApi({ createRewardedVideoAd: () => presetAd({ showResults: [{ errCode: 1 }, 'ok'] }) });
        const pending = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false }).showRewarded('u1');
        await flush();
        const ad = created[0];
        expect(ad.loadCalls).toBe(1);
        expect(ad.showCalls).toBe(2);
        ad.close({ isEnded: true });
        await expect(pending).resolves.toEqual({ result: 'completed' });
    });

    it('fails with load_failed and the error code when reload also fails', async () => {
        const { api } = fakeApi({
            createRewardedVideoAd: () => presetAd({ showResults: [{ errCode: 1004 }], loadResult: { errCode: 1004 } }),
        });
        const result = await new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false }).showRewarded(
            'u2',
        );
        expect(result).toEqual({ result: 'failed', reason: 'load_failed', errCode: 1004 });
        expect(created[0].loadCalls).toBe(1);
        expect(created[0].listeners.close).toHaveLength(0);
    });

    it('destroys interstitial after it is shown when recreation is required', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: true });
        const pending = provider.showInterstitial('i1');
        await flush();
        ads[0].close();
        await expect(pending).resolves.toEqual({ result: 'shown' });
        expect(ads[0].destroyed).toBe(true);
        const next = provider.showInterstitial('i1');
        await flush();
        expect(api.createInterstitialAd).toHaveBeenCalledTimes(2);
        ads[1].close();
        await expect(next).resolves.toEqual({ result: 'shown' });
        expect(ads[1].destroyed).toBe(true);
    });

    it('keeps the interstitial instance when it was never shown', async () => {
        const { api } = fakeApi({
            createInterstitialAd: vi.fn(() =>
                presetAd({ showResults: [{ errCode: 2002 }], loadResult: { errCode: 2002 } }),
            ),
        });
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: true });
        await expect(provider.showInterstitial('i1')).resolves.toEqual({
            result: 'failed',
            reason: 'load_failed',
            errCode: 2002,
        });
        expect(created[0].destroyed).toBe(false);
        created[0].showResults = ['ok'];
        const next = provider.showInterstitial('i1');
        await flush();
        expect(api.createInterstitialAd).toHaveBeenCalledTimes(1);
        created[0].close();
        await expect(next).resolves.toEqual({ result: 'shown' });
    });

    it('treats an empty close result without isEnded as skipped', async () => {
        const { api, ads } = fakeApi();
        const pending = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false }).showRewarded('u');
        await flush();
        ads[0].close({});
        await expect(pending).resolves.toEqual({ result: 'skipped' });
    });

    it('fails a shown ad that errors without closing', async () => {
        const { api, ads } = fakeApi();
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: true });
        const pending = provider.showInterstitial('i1');
        await flush();
        const onError = ads[0].onError.mock.calls[0][0] as (err: unknown) => void;
        onError({ errCode: 1003 });
        await expect(pending).resolves.toEqual({ result: 'failed', reason: 'show_failed', errCode: 1003 });
        expect(ads[0].destroyed).toBe(true);
        expect(ads[0].offError).toHaveBeenCalled();
    });

    it('ignores errors raised before the ad is shown', async () => {
        const { api } = fakeApi({
            createRewardedVideoAd: () => presetAd({ showResults: [{ errCode: 1 }, 'ok'] }),
        });
        const pending = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false }).showRewarded('u');
        const onError = created[0].onError.mock.calls[0][0] as (err: unknown) => void;
        onError({ errCode: 1 });
        await flush();
        created[0].close({ isEnded: true });
        await expect(pending).resolves.toEqual({ result: 'completed' });
    });

    it('reports unsupported or creation failure', async () => {
        const { api } = fakeApi({ createRewardedVideoAd: undefined });
        const provider = new MiniGameAdProvider(asApi(api), { recreateInterstitialAfterShow: false });
        await expect(provider.showRewarded('u')).resolves.toEqual({ result: 'failed', reason: 'unsupported' });
        const throwing = fakeApi({
            createInterstitialAd: () => {
                throw Object.assign(new Error('bad'), { errCode: 1002 });
            },
        });
        const p2 = new MiniGameAdProvider(asApi(throwing.api), { recreateInterstitialAfterShow: false });
        await expect(p2.showInterstitial('i')).resolves.toEqual({
            result: 'failed',
            reason: 'load_failed',
            errCode: 1002,
        });
    });
});

describe('DouyinRecorder', () => {
    function recorderSetup() {
        const listeners: Record<string, (res?: unknown) => void> = {};
        const manager = {
            start: vi.fn(() => listeners.start?.()),
            stop: vi.fn(() => listeners.stop?.({ videoPath: 'ttfile://video.mp4' })),
            onStart: (l: () => void) => (listeners.start = l),
            onStop: (l: (res?: unknown) => void) => (listeners.stop = l),
            onError: (l: (err?: unknown) => void) => (listeners.error = l),
        };
        const shareAppMessage = vi.fn((o: { success: () => void }) => o.success());
        douyin({ getGameRecorderManager: () => manager, shareAppMessage });
        let now = 0;
        const recorder = new DouyinRecorder(() => now);
        return { recorder, manager, listeners, shareAppMessage, advance: (ms: number) => (now += ms) };
    }

    it('records, returns the video path and shares it to the video channel', async () => {
        const s = recorderSetup();
        expect(s.recorder.supported).toBe(true);
        await expect(s.recorder.start({ duration: 1 })).resolves.toBe(true);
        expect(s.manager.start).toHaveBeenCalledWith({ duration: 3 });
        s.advance(5000);
        await expect(s.recorder.stop()).resolves.toBe('ttfile://video.mp4');
        await expect(s.recorder.share('ttfile://video.mp4', { title: 't', topics: ['游戏'] })).resolves.toBe('success');
        expect(s.shareAppMessage.mock.calls[0][0]).toMatchObject({
            channel: 'video',
            extra: { videoPath: 'ttfile://video.mp4', hashtag_list: ['游戏'], videoTopics: ['游戏'] },
        });
    });

    it('returns null for recordings shorter than the minimum', async () => {
        const s = recorderSetup();
        await s.recorder.start();
        s.advance(1000);
        await expect(s.recorder.stop()).resolves.toBeNull();
    });

    it('keeps the video when recording ends automatically and rejects overlapping starts', async () => {
        const s = recorderSetup();
        await s.recorder.start();
        await expect(s.recorder.start()).resolves.toBe(false);
        s.advance(60000);
        s.listeners.stop?.({ videoPath: 'ttfile://auto.mp4' });
        await expect(s.recorder.stop()).resolves.toBe('ttfile://auto.mp4');
        await expect(s.recorder.stop()).resolves.toBeNull();
    });

    it('stops a recording that starts after the start timeout', async () => {
        vi.useFakeTimers();
        try {
            const s = recorderSetup();
            s.manager.start.mockImplementation(() => undefined);
            const started = s.recorder.start();
            vi.advanceTimersByTime(3000);
            await expect(started).resolves.toBe(false);
            s.manager.stop.mockClear();
            s.listeners.start?.();
            expect(s.manager.stop).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops a recording requested to stop while it is starting', async () => {
        vi.useFakeTimers();
        try {
            const s = recorderSetup();
            s.manager.start.mockImplementation(() => undefined);
            let started: boolean | undefined;
            void s.recorder.start().then((ok) => (started = ok));
            await expect(s.recorder.stop()).resolves.toBeNull();
            expect(started).toBe(false);
            s.manager.stop.mockClear();
            s.listeners.start?.();
            expect(s.manager.stop).toHaveBeenCalledTimes(1);
            s.manager.start.mockImplementation(() => s.listeners.start?.());
            await expect(s.recorder.start()).resolves.toBe(true);
            s.advance(5000);
            await expect(s.recorder.stop()).resolves.toBe('ttfile://video.mp4');
        } finally {
            vi.useRealTimers();
        }
    });

    it('returns the same result to repeated stop calls and stops the platform once', async () => {
        const s = recorderSetup();
        s.manager.stop.mockImplementation(() => undefined);
        await s.recorder.start();
        s.advance(5000);
        const first = s.recorder.stop();
        const second = s.recorder.stop();
        expect(s.manager.stop).toHaveBeenCalledTimes(1);
        s.listeners.stop?.({ videoPath: 'ttfile://once.mp4' });
        await expect(first).resolves.toBe('ttfile://once.mp4');
        await expect(second).resolves.toBe('ttfile://once.mp4');
        await expect(s.recorder.stop()).resolves.toBeNull();
    });

    it('gives up waiting for the platform stop and can record again', async () => {
        vi.useFakeTimers();
        try {
            const s = recorderSetup();
            s.manager.stop.mockImplementation(() => undefined);
            await s.recorder.start();
            const stopped = s.recorder.stop();
            await vi.advanceTimersByTimeAsync(5000);
            await expect(stopped).resolves.toBeNull();
            await expect(s.recorder.start()).resolves.toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('can record again after the platform stop throws', async () => {
        const s = recorderSetup();
        await s.recorder.start();
        s.manager.stop.mockImplementationOnce(() => {
            throw new Error('stop failed');
        });
        await expect(s.recorder.stop()).resolves.toBeNull();
        await expect(s.recorder.start()).resolves.toBe(true);
    });

    it('ignores a late platform stop that arrives after the stop timeout', async () => {
        vi.useFakeTimers();
        try {
            const s = recorderSetup();
            s.manager.stop.mockImplementation(() => undefined);
            await s.recorder.start();
            const stopped = s.recorder.stop();
            await vi.advanceTimersByTimeAsync(5000);
            await expect(stopped).resolves.toBeNull();
            s.listeners.stop?.({ videoPath: 'ttfile://old.mp4' });
            await s.recorder.start();
            s.advance(5000);
            const next = s.recorder.stop();
            s.listeners.stop?.({ videoPath: 'ttfile://new.mp4' });
            await expect(next).resolves.toBe('ttfile://new.mp4');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the auto-stopped video of the next recording when the late platform stop never arrives', async () => {
        vi.useFakeTimers();
        try {
            const s = recorderSetup();
            s.manager.stop.mockImplementation(() => undefined);
            await s.recorder.start();
            const stopped = s.recorder.stop();
            await vi.advanceTimersByTimeAsync(5000);
            await expect(stopped).resolves.toBeNull();
            await s.recorder.start({ duration: 10 });
            s.advance(10000);
            s.listeners.stop?.({ videoPath: 'ttfile://auto.mp4' });
            await expect(s.recorder.stop()).resolves.toBe('ttfile://auto.mp4');
            await expect(s.recorder.start()).resolves.toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports failures and missing support', async () => {
        const s = recorderSetup();
        s.manager.start.mockImplementation(() => s.listeners.error?.({ errMsg: 'fail' }));
        await expect(s.recorder.start()).resolves.toBe(false);
        await expect(s.recorder.stop()).resolves.toBeNull();
        douyin();
        const none = new DouyinRecorder();
        expect(none.supported).toBe(false);
        await expect(none.start()).resolves.toBe(false);
    });
});
