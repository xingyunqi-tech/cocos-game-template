import type { IPayment, PayItem, PayResult } from './types';

export const unsupportedPayment: IPayment = {
    supported: false,
    pay: () => Promise.resolve({ result: 'failed', reason: 'unsupported' }),
};

/** 包装平台支付：同一时间只允许一笔，调试时可模拟结果 */
export const PAY_TIMEOUT_MS = 120000;

export class PaymentService {
    private impl: IPayment = unsupportedPayment;
    private paying = false;
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
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const timeout = new Promise<PayResult>((resolve) => {
                timer = setTimeout(() => resolve({ result: 'pending', reason: 'timeout' }), this.timeoutMs);
            });
            return this.emit(item, await Promise.race([this.impl.pay(item), timeout]));
        } catch {
            return this.emit(item, { result: 'failed', reason: 'pay_failed' });
        } finally {
            clearTimeout(timer);
            this.paying = false;
        }
    }

    queryOrder(orderId: string): Promise<PayResult> {
        if (!this.impl.queryOrder) return Promise.resolve({ result: 'failed', reason: 'unsupported', orderId });
        return this.impl.queryOrder(orderId).catch(() => ({ result: 'pending' as const, orderId }));
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
