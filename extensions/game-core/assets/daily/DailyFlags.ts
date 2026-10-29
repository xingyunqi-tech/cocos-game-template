import type { DailyStoreOptions } from './DailyCounter';
import { dayNumber, isRollback, ROLLBACK_TOLERANCE_DAYS } from './date';

/** 键为标记名，值为最近一次领取的日期 */
export type DailyFlagsData = Record<string, string>;

/** 每天一次的标记（如每日首胜、每日挑战）；日期回拨时不能领取 */
export class DailyFlags {
    constructor(private readonly options: DailyStoreOptions<DailyFlagsData>) {}

    canClaim(name: string): boolean {
        if (this.options.ready && !this.options.ready()) return false;
        const last = this.options.store.get()[name] ?? '';
        const today = this.options.today();
        return last !== today && !isRollback(last, today);
    }

    /** 今天可领取时记录并返回 true；同时清除早于回拨容忍范围的记录 */
    claim(name: string): boolean {
        if (!this.canClaim(name)) return false;
        const today = this.options.today();
        const oldest = dayNumber(today) - ROLLBACK_TOLERANCE_DAYS;
        const kept = Object.entries(this.options.store.get()).filter(([, date]) => dayNumber(date) >= oldest);
        this.options.store.set({ ...Object.fromEntries(kept), [name]: today });
        return true;
    }
}
