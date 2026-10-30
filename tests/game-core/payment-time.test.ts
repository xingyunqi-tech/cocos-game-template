import { describe, expect, it, vi } from 'vitest';
import { PaymentService, unsupportedPayment } from 'db://game-core/payment/Payment';
import type { IPayment, OrderStore, PayResult, PendingOrder } from 'db://game-core/payment/types';
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

    it('includes the created order id in the timeout result and in the late platform result', async () => {
        vi.useFakeTimers();
        try {
            const onResult = vi.fn();
            const late = vi.fn();
            const service = new PaymentService(onResult, 1000);
            service.onLateResult(late);
            let finish: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o9');
                    return new Promise<PayResult>((r) => (finish = r));
                },
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await expect(pending).resolves.toEqual({ result: 'pending', reason: 'timeout', orderId: 'o9' });
            expect(late).not.toHaveBeenCalled();
            finish({ result: 'failed', reason: 'cancelled' });
            await vi.waitFor(() =>
                expect(late).toHaveBeenCalledWith(item, { result: 'failed', reason: 'cancelled', orderId: 'o9' }),
            );
            expect(onResult).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not report late results for payments that finish in time', async () => {
        const late = vi.fn();
        const service = new PaymentService(undefined, 1000);
        service.onLateResult(late);
        service.setImplementation({
            supported: true,
            pay: () => Promise.resolve({ result: 'success', orderId: 'o1' }),
        });
        await expect(service.pay(item)).resolves.toEqual({ result: 'success', orderId: 'o1' });
        await Promise.resolve();
        expect(late).not.toHaveBeenCalled();
    });

    it('reports a synchronous implementation error as pay_failed', async () => {
        const service = new PaymentService();
        service.setImplementation({
            supported: true,
            pay: () => {
                throw new Error('boom');
            },
        });
        await expect(service.pay(item)).resolves.toEqual({ result: 'failed', reason: 'pay_failed' });
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

function memoryOrders(initial: PendingOrder[] = []) {
    let orders = initial;
    const store: OrderStore = { load: () => orders, save: (next) => (orders = next) };
    return { store, current: () => orders };
}

describe('PaymentService pending orders', () => {
    it('stores pending orders with an order id and removes them when the late result arrives', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            const service = new PaymentService(undefined, 1000, () => 5);
            service.setOrderStore(orders.store);
            let finish: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o1');
                    return new Promise<PayResult>((r) => (finish = r));
                },
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            expect(orders.current()).toEqual([{ orderId: 'o1', item, time: 5 }]);
            finish({ result: 'success' });
            await vi.waitFor(() => expect(orders.current()).toEqual([]));
        } finally {
            vi.useRealTimers();
        }
    });

    it('stores pending platform results but not timeouts without an order id', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            const service = new PaymentService(undefined, 1000, () => 5);
            service.setOrderStore(orders.store);
            service.setImplementation({ supported: true, pay: () => new Promise(() => undefined) });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            expect(orders.current()).toEqual([]);
            service.setImplementation({
                supported: true,
                pay: () => Promise.resolve({ result: 'pending', orderId: 'o2' }),
            });
            await service.pay(item);
            expect(orders.current()).toEqual([{ orderId: 'o2', item, time: 5 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('recovers stored orders through queryOrder and keeps those still pending', async () => {
        const day = 24 * 3600 * 1000;
        const orders = memoryOrders([
            { orderId: 'paid', item, time: 0 },
            { orderId: 'waiting', item, time: 0 },
            { orderId: 'old', item, time: -8 * day },
            { orderId: 'bad' } as PendingOrder,
        ]);
        const late = vi.fn();
        const queryOrder = vi.fn((orderId: string) =>
            Promise.resolve<PayResult>(orderId === 'paid' ? { result: 'success' } : { result: 'pending', orderId }),
        );
        const service = new PaymentService(undefined, 1000, () => 0);
        service.onLateResult(late);
        service.setOrderStore(orders.store);
        service.setImplementation({ supported: true, pay: vi.fn(), queryOrder });
        await Promise.all([service.recoverOrders(), service.recoverOrders()]);
        expect(queryOrder.mock.calls).toEqual([['paid'], ['waiting']]);
        expect(late).toHaveBeenCalledWith(item, { result: 'success', orderId: 'paid' });
        expect(service.pendingOrders()).toEqual([{ orderId: 'waiting', item, time: 0 }]);
    });

    it('keeps orders whose query throws synchronously or never answers', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders([
                { orderId: 'throws', item, time: 0 },
                { orderId: 'silent', item, time: 0 },
                { orderId: 'paid', item, time: 0 },
            ]);
            const late = vi.fn();
            const service = new PaymentService(undefined, 1000, () => 0, 5000);
            service.onLateResult(late);
            service.setOrderStore(orders.store);
            service.setImplementation({
                supported: true,
                pay: vi.fn(),
                queryOrder: (orderId) => {
                    if (orderId === 'throws') throw new Error('sync');
                    if (orderId === 'silent') return new Promise<PayResult>(() => undefined);
                    return Promise.resolve<PayResult>({ result: 'success' });
                },
            });
            const recovering = service.recoverOrders();
            await vi.advanceTimersByTimeAsync(5000);
            await recovering;
            expect(late).toHaveBeenCalledWith(item, { result: 'success', orderId: 'paid' });
            expect(service.pendingOrders().map((o) => o.orderId)).toEqual(['throws', 'silent']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stores a pending order reported through onOrder when the result has no order id', async () => {
        const orders = memoryOrders();
        const service = new PaymentService(undefined, 1000, () => 0);
        service.setOrderStore(orders.store);
        service.setImplementation({
            supported: true,
            pay: (_item, hooks) => {
                hooks?.onOrder('o1');
                return Promise.resolve<PayResult>({ result: 'pending' });
            },
        });
        await expect(service.pay(item)).resolves.toEqual({ result: 'pending', orderId: 'o1' });
        expect(orders.current().map((o) => o.orderId)).toEqual(['o1']);
    });

    it('reports an order once when its late result arrives during recovery', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            const late = vi.fn();
            let now = 0;
            const service = new PaymentService(undefined, 1000, () => now);
            service.onLateResult(late);
            service.setOrderStore(orders.store);
            let finish: (result: PayResult) => void = () => undefined;
            let answer: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o1');
                    return new Promise<PayResult>((r) => (finish = r));
                },
                queryOrder: () => new Promise<PayResult>((r) => (answer = r)),
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            now = 50;
            const recovering = service.recoverOrders();
            finish({ result: 'success' });
            await vi.waitFor(() => expect(late).toHaveBeenCalledTimes(1));
            answer({ result: 'success', orderId: 'o1' });
            await recovering;
            expect(late).toHaveBeenCalledTimes(1);
            expect(orders.current()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports an order once when its late result arrives after recovery', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            const late = vi.fn();
            const service = new PaymentService(undefined, 1000, () => 0);
            service.onLateResult(late);
            service.setOrderStore(orders.store);
            let finish: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o1');
                    return new Promise<PayResult>((r) => (finish = r));
                },
                queryOrder: () => Promise.resolve<PayResult>({ result: 'success', orderId: 'o1' }),
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            await service.recoverOrders();
            expect(late).toHaveBeenCalledTimes(1);
            finish({ result: 'success' });
            await vi.advanceTimersByTimeAsync(0);
            expect(late).toHaveBeenCalledTimes(1);
            expect(orders.current()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a recovered order out of the store when a late pending result arrives', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            const late = vi.fn();
            const service = new PaymentService(undefined, 1000, () => 0);
            service.onLateResult(late);
            service.setOrderStore(orders.store);
            let finish: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o1');
                    return new Promise<PayResult>((r) => (finish = r));
                },
                queryOrder: () => Promise.resolve<PayResult>({ result: 'success', orderId: 'o1' }),
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            await service.recoverOrders();
            expect(late).toHaveBeenCalledTimes(1);
            finish({ result: 'pending' });
            await vi.advanceTimersByTimeAsync(0);
            expect(late).toHaveBeenCalledTimes(1);
            expect(orders.current()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the original time when a late result is still pending', async () => {
        vi.useFakeTimers();
        try {
            const orders = memoryOrders();
            let now = 5;
            const service = new PaymentService(undefined, 1000, () => now);
            service.setOrderStore(orders.store);
            let finish: (result: PayResult) => void = () => undefined;
            service.setImplementation({
                supported: true,
                pay: (_item, hooks) => {
                    hooks?.onOrder('o1');
                    return new Promise<PayResult>((r) => (finish = r));
                },
            });
            const pending = service.pay(item);
            vi.advanceTimersByTime(1000);
            await pending;
            now = 99;
            finish({ result: 'pending' });
            await vi.advanceTimersByTimeAsync(0);
            expect(orders.current()).toEqual([{ orderId: 'o1', item, time: 5 }]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps stored orders when the implementation cannot query them', async () => {
        const orders = memoryOrders([{ orderId: 'o1', item, time: 0 }]);
        const service = new PaymentService();
        service.setOrderStore(orders.store);
        service.setImplementation({ supported: true, pay: vi.fn() });
        await service.recoverOrders();
        expect(orders.current()).toHaveLength(1);
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
