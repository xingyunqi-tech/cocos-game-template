import { describe, expect, it, vi } from 'vitest';
import { PaymentService, unsupportedPayment } from 'db://game-core/payment/Payment';
import type { IPayment, PayResult } from 'db://game-core/payment/types';
import { ServerTime } from 'db://game-core/time/ServerTime';

const item = { productId: 'coin_100', price: 600 };

describe('PaymentService', () => {
    it('reports unsupported by default', async () => {
        const service = new PaymentService();
        expect(service.supported).toBe(false);
        await expect(service.pay(item)).resolves.toEqual({ result: 'failed', reason: 'unsupported' });
        expect(unsupportedPayment.supported).toBe(false);
    });

    it('delegates to the implementation, rejects concurrent payments and reports results', async () => {
        let finish!: (r: PayResult) => void;
        const impl: IPayment = { supported: true, pay: vi.fn(() => new Promise<PayResult>((r) => (finish = r))) };
        const onResult = vi.fn();
        const service = new PaymentService(onResult);
        service.setImplementation(impl);
        const first = service.pay(item);
        await expect(service.pay(item)).resolves.toEqual({ result: 'failed', reason: 'busy' });
        finish({ result: 'success', orderId: 'o1' });
        await expect(first).resolves.toEqual({ result: 'success', orderId: 'o1' });
        expect(onResult).toHaveBeenLastCalledWith(item, { result: 'success', orderId: 'o1' });
    });

    it('maps implementation errors and supports simulation', async () => {
        const service = new PaymentService();
        service.setImplementation({ supported: true, pay: () => Promise.reject(new Error('x')) });
        await expect(service.pay(item)).resolves.toEqual({ result: 'failed', reason: 'pay_failed' });
        service.simulate = 'success';
        await expect(service.pay(item)).resolves.toMatchObject({ result: 'success' });
        service.simulate = 'failed';
        await expect(service.pay(item)).resolves.toEqual({ result: 'failed', reason: 'pay_failed' });
    });
});

describe('PaymentService timeout and query', () => {
    it('returns pending when the platform never answers and accepts the next payment', async () => {
        vi.useFakeTimers();
        try {
            const service = new PaymentService(undefined, 1000);
            service.setImplementation({ supported: true, pay: () => new Promise(() => undefined) });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await expect(pending).resolves.toEqual({ result: 'pending', reason: 'timeout' });
            service.setImplementation({ supported: true, pay: () => Promise.resolve({ result: 'success' }) });
            await expect(service.pay(item)).resolves.toEqual({ result: 'success' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('queries orders through the implementation', async () => {
        const service = new PaymentService();
        await expect(service.queryOrder('o1')).resolves.toEqual({
            result: 'failed',
            reason: 'unsupported',
            orderId: 'o1',
        });
        service.setImplementation({
            supported: true,
            pay: () => Promise.resolve({ result: 'pending', orderId: 'o2' }),
            queryOrder: (orderId) => Promise.resolve({ result: 'success', orderId }),
        });
        await expect(service.queryOrder('o2')).resolves.toEqual({ result: 'success', orderId: 'o2' });
        service.setImplementation({ supported: true, pay: vi.fn(), queryOrder: () => Promise.reject(new Error('x')) });
        await expect(service.queryOrder('o3')).resolves.toEqual({ result: 'pending', orderId: 'o3' });
    });
});

describe('ServerTime', () => {
    function clocks() {
        const c = { wall: 1000, mono: 0 };
        const time = new ServerTime({ now: () => c.wall, monotonic: () => c.mono });
        return { c, time };
    }

    it('falls back to local time until calibrated', () => {
        const { time } = clocks();
        expect(time.calibrated).toBe(false);
        expect(time.now()).toBe(1000);
    });

    it('applies the server time with half the round trip on the monotonic clock', () => {
        const { c, time } = clocks();
        const started = time.mark();
        c.mono = 1000;
        time.sync(50000, started);
        expect(time.calibrated).toBe(true);
        expect(time.now()).toBe(50500);
        c.mono = 11000;
        expect(time.now()).toBe(60500);
    });

    it('ignores invalid values and parses Date headers with half a second added', () => {
        const { time } = clocks();
        time.sync(Number.NaN);
        time.syncFromDateHeader('not a date');
        expect(time.calibrated).toBe(false);
        time.syncFromDateHeader('Thu, 15 Oct 2026 16:30:00 GMT');
        expect(time.now()).toBe(Date.UTC(2026, 9, 15, 16, 30) + 500);
    });

    it('computes the natural day in the configured timezone', () => {
        const at = Date.UTC(2026, 9, 15, 16, 30);
        expect(new ServerTime({ now: () => at }).today()).toBe('2026-10-16');
        expect(new ServerTime({ now: () => at, timezoneOffsetMinutes: 0 }).today()).toBe('2026-10-15');
    });

    it('corrects the local clock by the server offset but stays uncalibrated without a monotonic clock', () => {
        const c = { wall: 1000 };
        const time = new ServerTime({ now: () => c.wall, monotonic: () => null });
        expect(time.synced).toBe(false);
        time.sync(50000, time.mark());
        expect(time.synced).toBe(true);
        expect(time.calibrated).toBe(false);
        expect(time.now()).toBe(50000);
        c.wall += 1000;
        expect(time.now()).toBe(51000);
    });

    it('ignores changes to the local wall clock after calibration', () => {
        const { c, time } = clocks();
        time.sync(Date.UTC(2026, 9, 15, 4, 0));
        c.wall += 24 * 3600 * 1000;
        expect(time.today()).toBe('2026-10-15');
        c.mono += 3600 * 1000;
        expect(time.now()).toBe(Date.UTC(2026, 9, 15, 5, 0));
    });
});
