import { describe, expect, it, vi } from 'vitest';
import { Lifecycle, UserReady } from 'db://game-core/boot/Lifecycle';
import { RemoteConfig, type RemoteSettingsMap } from 'db://game-core/config/RemoteConfig';
import {
    ErrorReporter,
    ErrorThrottle,
    installWebErrorHooks,
    type ErrorReport,
    type ErrorSink,
} from 'db://game-core/monitor/errors';
import { LogHub, type LogSink } from 'db://game-core/monitor/logger';
import { Tracker } from 'db://game-core/monitor/track';

describe('LogHub', () => {
    it('drops records below the minimum level', () => {
        const sink = vi.fn<LogSink>();
        const hub = new LogHub('warn', [sink]);
        const log = hub.create('t');
        log.debug('a');
        log.info('b');
        log.warn('c');
        log.error('d');
        expect(sink.mock.calls.map(([r]) => r.level)).toEqual(['warn', 'error']);
    });

    it('keeps writing when a sink throws', () => {
        const good = vi.fn();
        const hub = new LogHub('debug', [
            () => {
                throw new Error('x');
            },
            good,
        ]);
        hub.create('t').info('ok');
        expect(good).toHaveBeenCalledOnce();
    });
});

describe('Tracker', () => {
    it('merges common params into each event', () => {
        const sink = vi.fn();
        const tracker = new Tracker();
        tracker.addSink(sink);
        tracker.setCommonParams({ version: '1.0' });
        tracker.track('start', { step: 'a' });
        expect(sink.mock.calls[0][0]).toMatchObject({ event: 'start', params: { version: '1.0', step: 'a' } });
    });
});

describe('ErrorThrottle', () => {
    const report = (message: string, context: Record<string, unknown> = {}): ErrorReport => ({
        source: 'global',
        message,
        context,
        time: 0,
    });

    it('merges identical errors within the dedupe window and forwards the merged count afterwards', () => {
        let now = 0;
        const sink = vi.fn();
        const throttle = new ErrorThrottle(sink, { dedupeMs: 1000, now: () => now });
        for (let i = 0; i < 5; i++) throttle.push(report('frame', { url: '/a' }));
        throttle.push(report('frame', { url: '/b' }));
        expect(sink).toHaveBeenCalledTimes(2);
        now = 1000;
        throttle.push(report('frame', { url: '/a' }));
        expect(sink.mock.calls[2][0]).toMatchObject({ message: 'frame', context: { url: '/a', repeated: 4 } });
    });

    it('forwards pending merged and dropped counts on flush', () => {
        const sink = vi.fn();
        const throttle = new ErrorThrottle(sink, { maxPerMinute: 2, now: () => 0 });
        throttle.push(report('a'));
        throttle.push(report('a'));
        throttle.push(report('b'));
        throttle.push(report('c'));
        throttle.push(report('d'));
        expect(sink).toHaveBeenCalledTimes(2);
        throttle.flush();
        expect(sink.mock.calls.slice(2).map((c) => (c[0] as ErrorReport).context)).toEqual([
            { repeated: 1, dropped: 2 },
        ]);
        throttle.flush();
        expect(sink).toHaveBeenCalledTimes(3);
    });

    it('forwards a summary when only dropped reports are pending', () => {
        const sink = vi.fn();
        const throttle = new ErrorThrottle(sink, { maxPerMinute: 1, now: () => 0 });
        throttle.push(report('a'));
        throttle.push(report('b'));
        throttle.flush();
        expect(sink.mock.calls[1][0]).toMatchObject({ message: '错误上报超过频率上限', context: { dropped: 1 } });
    });
});

describe('ErrorReporter', () => {
    it('normalizes errors and attaches context', () => {
        const sink = vi.fn();
        const reporter = new ErrorReporter();
        reporter.addSink(sink);
        reporter.setContext({ platform: 'web' });
        reporter.report(new Error('boom'), 'http', { url: '/x' });
        reporter.report('plain', 'manual');
        expect(sink.mock.calls[0][0]).toMatchObject({
            source: 'http',
            message: 'boom',
            context: { platform: 'web', url: '/x' },
        });
        expect(sink.mock.calls[1][0]).toMatchObject({ message: 'plain' });
    });

    it('describes an undefined error as text', () => {
        const sink = vi.fn();
        const reporter = new ErrorReporter();
        reporter.addSink(sink);
        reporter.report(undefined, 'promise');
        expect(sink.mock.calls[0][0]).toMatchObject({ message: 'undefined' });
    });

    it('captures web error and unhandledrejection events', () => {
        const target = new EventTarget();
        const sink = vi.fn<ErrorSink>();
        const reporter = new ErrorReporter();
        reporter.addSink(sink);
        const uninstall = installWebErrorHooks(target, reporter);
        target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('e1') }));
        target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('e2') }));
        uninstall();
        target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('e3') }));
        expect(sink.mock.calls.map(([r]) => [r.source, r.message])).toEqual([
            ['global', 'e1'],
            ['promise', 'e2'],
        ]);
    });
});

describe('Lifecycle', () => {
    it('dispatches show and hide from the bound message source until disposed', () => {
        const handlers = new Map<string, { listener: () => void; target: object }>();
        const source = {
            on: (event: string, listener: () => void, target: object) => void handlers.set(event, { listener, target }),
            off: (event: string, listener?: () => void, target?: object) => {
                const entry = handlers.get(event);
                if (entry && entry.listener === listener && entry.target === target) handlers.delete(event);
            },
        };
        const lifecycle = new Lifecycle();
        const hide = vi.fn();
        lifecycle.onHide(hide);
        lifecycle.bind(source, 'show', 'hide');
        handlers.get('hide')?.listener();
        expect(hide).toHaveBeenCalledOnce();
        lifecycle.dispose();
        expect(handlers.size).toBe(0);
    });

    it('isolates listener failures', () => {
        const lifecycle = new Lifecycle();
        const after = vi.fn();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        lifecycle.onShow(() => {
            throw new Error('x');
        });
        lifecycle.onShow(after);
        lifecycle.emitShow();
        expect(after).toHaveBeenCalledOnce();
        spy.mockRestore();
    });
});

describe('RemoteConfig', () => {
    it('uses defaults without a fetcher', async () => {
        const config = new RemoteConfig({ reviewMode: false });
        await expect(config.load()).resolves.toBe('defaults');
        expect(config.get('reviewMode')).toBe(false);
    });

    it('merges remote values', async () => {
        const config = new RemoteConfig({ reviewMode: false, shareReward: true });
        await config.load(() => Promise.resolve({ reviewMode: true }));
        expect(config.all()).toEqual({ reviewMode: true, shareReward: true });
        expect(config.source).toBe('remote');
    });

    it('falls back to defaults on failure or timeout', async () => {
        const config = new RemoteConfig({ reviewMode: false });
        await expect(config.load(() => Promise.reject(new Error('offline')))).resolves.toBe('defaults');
        await expect(config.load(() => new Promise(() => undefined), 10)).resolves.toBe('defaults');
        expect(config.get('reviewMode')).toBe(false);
    });
});

describe('RemoteConfig fallback', () => {
    it('uses the cached values when the fetch fails or times out', async () => {
        const config = new RemoteConfig({ a: 1, b: 2 });
        await expect(
            config.load(
                () => Promise.reject(new Error('x')),
                50,
                () => ({ a: 9 }),
            ),
        ).resolves.toBe('cache');
        expect(config.all()).toEqual({ a: 9, b: 2 });
        await expect(
            config.load(
                () => new Promise(() => undefined),
                10,
                () => ({ b: 7 }),
            ),
        ).resolves.toBe('cache');
        expect(config.all()).toEqual({ a: 1, b: 7 });
        await expect(
            config.load(
                () => Promise.reject(new Error('x')),
                50,
                () => null,
            ),
        ).resolves.toBe('cache');
        expect(config.all()).toEqual({ a: 1, b: 7 });
    });

    it('keeps the loaded remote values while reloading and when the reload fails without cache', async () => {
        const config = new RemoteConfig({ a: 1 });
        await config.load(() => Promise.resolve({ a: 5 }));
        let fail: (err: Error) => void = () => undefined;
        const reload = config.load(() => new Promise((_, reject) => (fail = reject)));
        expect(config.get('a')).toBe(5);
        fail(new Error('offline'));
        await expect(reload).resolves.toBe('remote');
        expect(config.get('a')).toBe(5);
        await expect(config.load()).resolves.toBe('defaults');
        expect(config.get('a')).toBe(1);
    });
});

describe('RemoteConfig merging', () => {
    it('merges nested objects and ignores values whose type differs from the default', async () => {
        const onInvalid = vi.fn();
        const config = new RemoteConfig(
            { reward: { coins: 10, gems: 1 }, enabled: false, levels: [1], extra: null },
            onInvalid,
        );
        await config.load(() =>
            Promise.resolve({
                reward: { coins: 20, gems: '2' },
                enabled: 'false',
                levels: { 0: 2 },
                extra: { any: true },
                added: 3,
            } as never),
        );
        expect(config.all()).toEqual({
            reward: { coins: 20, gems: 1 },
            enabled: false,
            levels: [1],
            extra: { any: true },
            added: 3,
        });
        expect(onInvalid.mock.calls).toEqual([
            ['reward.gems', '2'],
            ['enabled', 'false'],
            ['levels', { 0: 2 }],
        ]);
    });
});
describe('RemoteConfig validation', () => {
    it('checks array items against the default item type', async () => {
        const config = new RemoteConfig({ levels: [1, 2], tags: [] as string[] });
        await config.load(() => Promise.resolve({ levels: ['1'], tags: ['a', 1] } as never));
        expect(config.all()).toEqual({ levels: [1, 2], tags: ['a', 1] });
    });

    it('ignores __proto__ keys and does not compare keys with inherited members', async () => {
        const config = new RemoteConfig<Record<string, unknown>>({ a: 1 });
        await config.load(() => Promise.resolve(JSON.parse('{"__proto__": {"polluted": 1}, "toString": 2}')));
        expect(config.get('polluted')).toBeUndefined();
        expect(config.get('toString')).toBe(2);
        expect(Object.getPrototypeOf(config.all())).toBe(Object.prototype);
    });

    it('treats a non-object response or cache as a failure and keeps the current values', async () => {
        const config = new RemoteConfig({ a: 1 });
        await config.load(() => Promise.resolve({ a: 5 }));
        await expect(
            config.load(
                () => Promise.resolve(null as never),
                50,
                () => [9] as never,
            ),
        ).resolves.toBe('remote');
        expect(config.get('a')).toBe(5);
    });

    it('reports invalid values when loading but not again when defaults change', async () => {
        const onInvalid = vi.fn();
        const config = new RemoteConfig<Record<string, unknown>>({ on: false }, onInvalid);
        await config.load(() => Promise.resolve({ on: 'yes' }));
        config.setDefaults({ other: 1 });
        expect(onInvalid).toHaveBeenCalledTimes(1);
    });
});

declare module 'db://game-core/augment' {
    interface RemoteSettingsMap {
        testDailyLimit: number;
    }
}

describe('RemoteConfig defaults', () => {
    it('accepts defaults for keys added by declaration merging and keeps remote values first', async () => {
        const config = new RemoteConfig<RemoteSettingsMap>({ reviewMode: false, shareReward: false });
        expect(config.get('testDailyLimit')).toBeUndefined();
        config.setDefaults({ testDailyLimit: 3 });
        expect(config.get('testDailyLimit')).toBe(3);
        await config.load(() => Promise.resolve({ testDailyLimit: 5 }));
        config.setDefaults({ testDailyLimit: 4, reviewMode: true });
        expect(config.all()).toEqual({ reviewMode: true, shareReward: false, testDailyLimit: 5 });
        await config.load();
        expect(config.get('testDailyLimit')).toBe(4);
    });
});

describe('UserReady', () => {
    it('notifies listeners, replays the current state to late listeners and isolates errors', () => {
        const onError = vi.fn();
        const ready = new UserReady(onError);
        const early = vi.fn();
        ready.on(() => {
            throw new Error('bad');
        });
        const off = ready.on(early);
        expect(ready.current).toBeNull();
        ready.emit({ userId: 'guest-d', offline: true });
        expect(early).toHaveBeenCalledWith({ userId: 'guest-d', offline: true });
        expect(onError).toHaveBeenCalledTimes(1);
        const late = vi.fn();
        ready.on(late);
        expect(late).toHaveBeenCalledWith({ userId: 'guest-d', offline: true });
        off();
        ready.emit({ userId: 'guest-d', offline: false });
        expect(early).toHaveBeenCalledTimes(1);
        expect(late).toHaveBeenLastCalledWith({ userId: 'guest-d', offline: false });
        expect(ready.current).toEqual({ userId: 'guest-d', offline: false });
    });
});
