import type { IPayment, PayItem, PayResult } from './types';

export const unsupportedPayment: IPayment = {
    supported: false,
    pay: () => Promise.resolve({ result: 'failed', reason: 'unsupported' }),
};

/** 包装平台支付：同一时间只允许一笔，调试时可模拟结果 */
export const PAY_TIMEOUT_MS = 120000;

export type LatePayListener = (item: PayItem, result: PayResult) => void;

export class PaymentService {
    private impl: IPayment = unsupportedPayment;
    private paying = false;
    private readonly lateListeners: LatePayListener[] = [];
    simulate: PayResult['result'] | null = null;

    constructor(
        private readonly onResult?: (item: PayItem, result: PayResult) => void,
        private readonly timeoutMs = PAY_TIMEOUT_MS,
    ) {}

    setImplementation(impl: IPayment) {
        this.impl = impl;
    }

    get supported(): boolean {
        return this.simulate !== null || this.impl.supported;
    }

    /** 超时返回 pending 之后平台给出的结果；实现报告过订单号时结果带上该订单号 */
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
            return this.emit(item, await Promise.race([paid, timeout]));
        } finally {
            clearTimeout(timer);
            this.paying = false;
            if (timedOut) {
                void paid.then((late) =>
                    this.emitLate(item, late.orderId || !orderId ? { ...late } : { ...late, orderId }),
                );
            }
        }
    }

    queryOrder(orderId: string): Promise<PayResult> {
        if (!this.impl.queryOrder) return Promise.resolve({ result: 'failed', reason: 'unsupported', orderId });
        return this.impl.queryOrder(orderId).catch(() => ({ result: 'pending' as const, orderId }));
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
        try {
            this.onResult?.(item, result);
        } catch (err) {
            console.error('[game-core] 支付结果回调异常', err);
        }
        return result;
    }
}
