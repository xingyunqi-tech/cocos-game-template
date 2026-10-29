import { isRollback } from './date';

export interface DailyCounterData {
    date: string;
    counts: Record<string, number>;
}

export interface DailyStoreOptions<T> {
    store: { get(): T; set(value: T): void };
    /** 当天日期 YYYY-MM-DD */
    today: () => string;
    /** 返回 false 时只读：计数视为已用完、领取与记录不生效（如登录完成前） */
    ready?: () => boolean;
}

export function defaultDailyCounter(): DailyCounterData {
    return { date: '', counts: {} };
}

/** 按天计数（如每个广告位每天的次数）；跨天清零，日期回拨时沿用已记录的计数 */
export class DailyCounter {
    constructor(private readonly options: DailyStoreOptions<DailyCounterData>) {}

    uses(key: string): number {
        const data = this.options.store.get();
        return this.isCurrent(data) ? (data.counts[key] ?? 0) : 0;
    }

    remaining(key: string, limit: number): number {
        if (this.options.ready && !this.options.ready()) return 0;
        return Math.max(0, limit - this.uses(key));
    }

    /** count 为正整数；未就绪时不记录 */
    record(key: string, count = 1) {
        if (!Number.isInteger(count) || count <= 0) throw new Error(`计数必须为正整数：${count}`);
        if (this.options.ready && !this.options.ready()) return;
        const data = this.options.store.get();
        const current = this.isCurrent(data);
        const counts = current ? data.counts : {};
        this.options.store.set({
            date: current ? data.date : this.options.today(),
            counts: { ...counts, [key]: (counts[key] ?? 0) + count },
        });
    }

    /** 未达上限时记一次并返回 true */
    tryUse(key: string, limit: number): boolean {
        if (this.remaining(key, limit) <= 0) return false;
        this.record(key);
        return true;
    }

    private isCurrent(data: DailyCounterData): boolean {
        const today = this.options.today();
        return data.date === today || isRollback(data.date, today);
    }
}
