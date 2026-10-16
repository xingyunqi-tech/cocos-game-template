import { describe, expect, it, vi } from 'vitest';
import { Lifecycle } from 'db://game-core/boot/Lifecycle';
import { RemoteConfig } from 'db://game-core/config/RemoteConfig';
import { ErrorReporter, installWebErrorHooks, type ErrorSink } from 'db://game-core/monitor/errors';
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
        ).resolves.toBe('defaults');
        expect(config.all()).toEqual({ a: 1, b: 2 });
    });
});
