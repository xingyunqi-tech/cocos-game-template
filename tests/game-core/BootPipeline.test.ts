import { describe, expect, it } from 'vitest';
import { BootPipeline, BootStepError } from 'db://game-core/boot/BootPipeline';

describe('BootPipeline', () => {
    it('runs steps in order and reports weighted progress', async () => {
        const order: string[] = [];
        const progress: number[] = [];
        const pipeline = new BootPipeline()
            .register('a', () => void order.push('a'), { weight: 1 })
            .register(
                'b',
                (ctx) => {
                    order.push('b');
                    ctx.progress(0.5);
                },
                { weight: 3 },
            );
        await pipeline.run({ onProgress: (ratio) => progress.push(ratio) });
        expect(order).toEqual(['a', 'b']);
        expect(progress).toEqual([0, 0.25, 0.25, 0.625, 1]);
    });

    it('records durations per step', async () => {
        let t = 0;
        const pipeline = new BootPipeline().register('a', () => void (t += 40));
        const [result] = await pipeline.run({ now: () => t });
        expect(result).toMatchObject({ name: 'a', ok: true, durationMs: 40 });
    });

    it('continues after an optional step fails', async () => {
        const pipeline = new BootPipeline()
            .register('remote', () => Promise.reject(new Error('offline')), { optional: true })
            .register('enter', () => undefined);
        const results = await pipeline.run();
        expect(results.map((r) => [r.name, r.ok])).toEqual([
            ['remote', false],
            ['enter', true],
        ]);
    });

    it('stops with BootStepError when a required step fails', async () => {
        const pipeline = new BootPipeline()
            .register('login', () => {
                throw new Error('denied');
            })
            .register('enter', () => undefined);
        await expect(pipeline.run()).rejects.toMatchObject({ step: 'login' });
        await expect(pipeline.run()).rejects.toBeInstanceOf(BootStepError);
    });

    it('fails a step that exceeds its timeout', async () => {
        const pipeline = new BootPipeline().register('slow', () => new Promise(() => undefined), {
            timeoutMs: 10,
            optional: true,
        });
        const [result] = await pipeline.run();
        expect(result.ok).toBe(false);
        expect(String(result.error)).toContain('超时');
    });

    it('rejects duplicate step names', () => {
        const pipeline = new BootPipeline().register('a', () => undefined);
        expect(() => pipeline.register('a', () => undefined)).toThrow('重复');
    });
});

describe('BootPipeline ordering and cancellation', () => {
    it('inserts steps before or after a registered anchor', () => {
        const pipeline = new BootPipeline()
            .register('remote-config', () => undefined)
            .register('enter', () => undefined)
            .register('login', () => undefined, { before: 'remote-config' })
            .register('preload', () => undefined, { after: 'login' });
        expect(pipeline.stepNames).toEqual(['login', 'preload', 'remote-config', 'enter']);
    });

    it('resolves anchors registered later and keeps registration order for the same anchor', async () => {
        const order: string[] = [];
        const step = (name: string) => () => void order.push(name);
        const pipeline = new BootPipeline()
            .register('shop', step('shop'), { after: 'bundle' })
            .register('a', step('a'), { after: 'login' })
            .register('login', step('login'))
            .register('b', step('b'), { after: 'login' })
            .register('bundle', step('bundle'), { after: 'login' })
            .register('p1', step('p1'), { before: 'login' })
            .register('p2', step('p2'), { before: 'login' });
        expect(pipeline.stepNames).toEqual(['p1', 'p2', 'login', 'a', 'b', 'bundle', 'shop']);
        await pipeline.run();
        expect(order).toEqual(['p1', 'p2', 'login', 'a', 'b', 'bundle', 'shop']);
    });

    it('fails at run time when an anchor is missing or anchors form a cycle', async () => {
        const missing = new BootPipeline().register('x', () => undefined, { after: 'missing' });
        expect(() => missing.stepNames).toThrow('x → missing');
        await expect(missing.run()).rejects.toThrow('锚点未注册或循环依赖');
        const cycle = new BootPipeline()
            .register('a', () => undefined, { after: 'b' })
            .register('b', () => undefined, { after: 'a' });
        await expect(cycle.run()).rejects.toThrow('a → b，b → a');
        missing.register('missing', () => undefined);
        await expect(missing.run()).resolves.toHaveLength(2);
    });

    it('rejects a step with both before and after', () => {
        const pipeline = new BootPipeline().register('a', () => undefined);
        expect(() => pipeline.register('b', () => undefined, { before: 'a', after: 'a' })).toThrow('同时指定');
    });

    it('ignores progress from a timed-out step and signals it to stop', async () => {
        const holder: { late?: (ratio: number) => void } = {};
        let signalled = false;
        const progress: Array<[number, string]> = [];
        const pipeline = new BootPipeline()
            .register(
                'slow',
                (ctx) =>
                    new Promise(() => {
                        holder.late = (ratio) => ctx.progress(ratio);
                        ctx.signal.onCancel(() => (signalled = true));
                    }),
                { timeoutMs: 10, optional: true },
            )
            .register('next', () => undefined);
        await pipeline.run({ onProgress: (ratio, step) => progress.push([ratio, step]) });
        holder.late?.(0.9);
        expect(signalled).toBe(true);
        expect(progress).toEqual([
            [0, 'slow'],
            [0.5, 'slow'],
            [0.5, 'next'],
            [1, 'next'],
        ]);
    });

    it('reruns only unfinished steps after a failure and everything after reset', async () => {
        const order: string[] = [];
        let failB = true;
        let failOptional = true;
        const pipeline = new BootPipeline()
            .register('a', () => void order.push('a'))
            .register(
                'opt',
                () => {
                    order.push('opt');
                    if (failOptional) throw new Error('opt');
                },
                { optional: true },
            )
            .register('b', () => {
                order.push('b');
                if (failB) throw new Error('b');
            });
        await expect(pipeline.run()).rejects.toMatchObject({ step: 'b' });
        failB = false;
        failOptional = false;
        const progress: number[] = [];
        const results = await pipeline.run({ onProgress: (ratio) => progress.push(ratio) });
        expect(results.map((r) => r.name)).toEqual(['opt', 'b']);
        expect(progress[0]).toBeCloseTo(1 / 3);
        expect(order).toEqual(['a', 'opt', 'b', 'opt', 'b']);
        pipeline.reset();
        await pipeline.run();
        expect(order.slice(5)).toEqual(['a', 'opt', 'b']);
    });
});
