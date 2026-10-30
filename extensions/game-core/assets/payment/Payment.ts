import type { IPayment, OrderStore, PayItem, PayResult, PendingOrder } from './types';

export const unsupportedPayment: IPayment = {
    supported: false,
    pay: () => Promise.resolve({ result: 'failed', reason: 'unsupported' }),
};

/** 包装平台支付：同一时间只允许一笔，调试时可模拟结果 */
export const PAY_TIMEOUT_MS = 120000;
export const ORDER_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const ORDER_QUERY_TIMEOUT_MS = 15000;

function isPendingOrder(value: unknown): value is PendingOrder {
    const order = value as Partial<PendingOrder> | null;
    return (
        typeof order === 'object' &&
        order !== null &&
        typeof order.orderId === 'string' &&
        typeof order.time === 'number' &&
        typeof order.item === 'object' &&
        order.item !== null
    );
}

export type LatePayListener = (item: PayItem, result: PayResult) => void;

export class PaymentService {
    private impl: IPayment = unsupportedPayment;
    private paying = false;
    private readonly lateListeners: LatePayListener[] = [];
    private orders: OrderStore | null = null;
    private recovering: Promise<void> | null = null;
    /** 本次运行中已回调过最终结果的订单号 */
    private readonly settledOrders = new Set<string>();
    simulate: PayResult['result'] | null = null;

    constructor(
        private readonly onResult?: (item: PayItem, result: PayResult) => void,
        private readonly timeoutMs = PAY_TIMEOUT_MS,
        private readonly now: () => number = Date.now,
        private readonly queryTimeoutMs = ORDER_QUERY_TIMEOUT_MS,
    ) {}

    setImplementation(impl: IPayment) {
        this.impl = impl;
    }

    /** 带订单号的 pending 结果写入 store，等迟到结果或 recoverOrders 查询到最终结果后移除 */
    setOrderStore(store: OrderStore) {
        this.orders = store;
    }

    pendingOrders(): PendingOrder[] {
        return this.loadOrders();
    }

    get supported(): boolean {
        return this.simulate !== null || this.impl.supported;
    }

    /** 超时返回 pending 之后平台给出的结果，以及 recoverOrders 查询到的最终结果；实现报告过订单号时结果带上该订单号 */
    onLateResult(listener: LatePayListener): () => void {
        this.lateListeners.push(listener);
        return () => {
            const index = this.lateListeners.indexOf(listener);
            if (index >= 0) this.lateListeners.splice(index, 1);
        };
    }

    async pay(item: PayItem): Promise<PayResult> {
        if (this.paying) return this.emit(item, { result: 'failed', reason: 'busy' });
        if (this.simulate) {
            const simulated: PayResult =
                this.simulate === 'success'
                    ? { result: 'success', orderId: `sim-${Date.now()}` }
                    : { result: 'failed', reason: 'pay_failed' };
            return this.emit(item, simulated);
        }
        this.paying = true;
        let orderId: string | undefined;
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const failed = (): PayResult => ({ result: 'failed', reason: 'pay_failed' });
        const withOrder = (result: PayResult): PayResult =>
            result.orderId || !orderId ? result : { ...result, orderId };
        let paid: Promise<PayResult>;
        try {
            paid = Promise.resolve(this.impl.pay(item, { onOrder: (id) => (orderId = id) })).catch(failed);
        } catch {
            paid = Promise.resolve(failed());
        }
        try {
            const timeout = new Promise<PayResult>((resolve) => {
                timer = setTimeout(() => {
                    timedOut = true;
                    resolve(
                        orderId
                            ? { result: 'pending', reason: 'timeout', orderId }
                            : { result: 'pending', reason: 'timeout' },
                    );
                }, this.timeoutMs);
            });
            return this.emit(item, withOrder(await Promise.race([paid, timeout])));
        } finally {
            clearTimeout(timer);
            this.paying = false;
            if (timedOut) {
                void paid.then((late) => {
                    const result = { ...withOrder(late) };
                    if (result.orderId && this.settledOrders.has(result.orderId)) return;
                    if (result.orderId && result.result !== 'pending') {
                        this.settledOrders.add(result.orderId);
                        this.forgetOrder(result.orderId);
                    } else if (result.orderId) this.rememberOrder(item, result.orderId);
                    this.emitLate(item, result);
                });
            }
        }
    }

    /** 查询失败或超过 queryTimeoutMs 未返回时为 pending */
    queryOrder(orderId: string): Promise<PayResult> {
        const impl = this.impl;
        if (!impl.queryOrder) return Promise.resolve({ result: 'failed', reason: 'unsupported', orderId });
        const pending: PayResult = { result: 'pending', orderId };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<PayResult>((resolve) => {
            timer = setTimeout(() => resolve(pending), this.queryTimeoutMs);
        });
        const answered = new Promise<PayResult>((resolve) => resolve(impl.queryOrder!(orderId))).catch(() => pending);
        return Promise.race([answered, timeout]).finally(() => clearTimeout(timer));
    }

    /** 查询 store 中的 pending 订单，得到成功或失败时移除并通过 onLateResult 回调；超过 maxAgeMs 的订单直接移除。在 setImplementation 与 onLateResult 之后调用 */
    recoverOrders(maxAgeMs = ORDER_MAX_AGE_MS): Promise<void> {
        this.recovering ??= this.recover(maxAgeMs).finally(() => {
            this.recovering = null;
        });
        return this.recovering;
    }

    private async recover(maxAgeMs: number) {
        if (!this.orders || !this.impl.queryOrder) return;
        const now = this.now();
        const live: PendingOrder[] = [];
        for (const order of this.loadOrders()) {
            if (now - order.time > maxAgeMs) this.forgetOrder(order.orderId);
            else live.push(order);
        }
        await Promise.all(
            live.map(async (order) => {
                const result = await this.queryOrder(order.orderId);
                if (result.result === 'pending' || !this.forgetOrder(order.orderId)) return;
                this.settledOrders.add(order.orderId);
                this.emitLate(order.item, result.orderId ? result : { ...result, orderId: order.orderId });
            }),
        );
    }

    private loadOrders(): PendingOrder[] {
        if (!this.orders) return [];
        try {
            const orders = this.orders.load();
            return Array.isArray(orders) ? orders.filter(isPendingOrder) : [];
        } catch (err) {
            console.error('[game-core] 读取待确认订单失败', err);
            return [];
        }
    }

    private saveOrders(orders: PendingOrder[]) {
        try {
            this.orders?.save(orders);
        } catch (err) {
            console.error('[game-core] 保存待确认订单失败', err);
        }
    }

    private rememberOrder(item: PayItem, orderId: string) {
        if (!this.orders) return;
        const orders = this.loadOrders();
        if (orders.some((order) => order.orderId === orderId)) return;
        orders.push({ orderId, item: { ...item }, time: this.now() });
        this.saveOrders(orders);
    }

    /** 返回订单是否在 store 中 */
    private forgetOrder(orderId: string): boolean {
        const orders = this.loadOrders();
        const rest = orders.filter((order) => order.orderId !== orderId);
        if (rest.length === orders.length) return false;
        this.saveOrders(rest);
        return true;
    }

    private emitLate(item: PayItem, result: PayResult) {
        for (const listener of this.lateListeners.slice()) {
            try {
                listener(item, result);
            } catch (err) {
                console.error('[game-core] 支付结果回调异常', err);
            }
        }
    }

    private emit(item: PayItem, result: PayResult): PayResult {
        if (result.result === 'pending' && result.orderId) this.rememberOrder(item, result.orderId);
        try {
            this.onResult?.(item, result);
        } catch (err) {
            console.error('[game-core] 支付结果回调异常', err);
        }
        return result;
    }
}
