export type WalletData<K extends string> = Record<K, number>;

export type WalletListener<K extends string> = (key: K, amount: number, delta: number) => void;

const validAmount = (amount: number) => Number.isFinite(amount) && amount >= 0;

/** 货币与道具数量，只通过 add 增加、spend / exchange 扣除，数量不会小于 0；ready 返回 false 时（如登录完成前）不能修改 */
export class Wallet<K extends string> {
    private listeners: Array<WalletListener<K>> = [];

    constructor(
        private readonly store: { get(): WalletData<K>; set(value: WalletData<K>): void },
        private readonly ready: () => boolean = () => true,
    ) {}

    get(key: K): number {
        return this.store.get()[key] ?? 0;
    }

    /** amount 为有限非负数；未就绪时抛错 */
    add(key: K, amount: number) {
        if (!validAmount(amount)) throw new Error(`add 只接受有限非负数，扣除 ${key} 用 spend：${amount}`);
        if (!this.ready()) throw new Error('用户存档未就绪，不能修改钱包');
        this.apply({ [key]: amount } as Partial<Record<K, number>>);
    }

    /** 数量足够时扣除并返回 true */
    spend(key: K, amount = 1): boolean {
        if (!validAmount(amount) || !this.ready() || this.get(key) < amount) return false;
        this.apply({ [key]: -amount } as Partial<Record<K, number>>);
        return true;
    }

    /** 扣除 cost 换取 gain（如金币买道具），cost 不足时不变并返回 false */
    exchange(cost: K, costAmount: number, gain: K, gainAmount = 1): boolean {
        if (!validAmount(costAmount) || !validAmount(gainAmount) || !this.ready() || this.get(cost) < costAmount) {
            return false;
        }
        if (cost === gain) {
            this.apply({ [cost]: gainAmount - costAmount } as Partial<Record<K, number>>);
        } else {
            this.apply({ [cost]: -costAmount, [gain]: gainAmount } as Partial<Record<K, number>>);
        }
        return true;
    }

    /** 数量变化时回调，返回取消函数 */
    onChange(listener: WalletListener<K>): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private apply(deltas: Partial<Record<K, number>>) {
        const next = { ...this.store.get() };
        const changed: Array<[K, number]> = [];
        for (const key of Object.keys(deltas) as K[]) {
            const delta = deltas[key] ?? 0;
            if (delta === 0) continue;
            next[key] = (next[key] ?? 0) + delta;
            changed.push([key, delta]);
        }
        if (changed.length === 0) return;
        this.store.set(next);
        for (const [key, delta] of changed) {
            for (const listener of this.listeners.slice()) {
                try {
                    listener(key, next[key], delta);
                } catch (err) {
                    console.error('[game-core] 钱包回调异常', err);
                }
            }
        }
    }
}
