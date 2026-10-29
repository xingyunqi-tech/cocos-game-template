import type { DailyStoreOptions } from './DailyCounter';
import { dayNumber, isRollback } from './date';

export interface LoginStreakData {
    lastLogin: string;
    /** 当前周期内的连续登录天数 */
    streak: number;
}

export interface LoginStreakResult {
    /** 本次是否为今天首次记录 */
    counted: boolean;
    /** 当前周期内的第几天，1 开始；周期完成的当天等于 cycleDays */
    day: number;
    /** 本次登录完成一个周期 */
    cycleComplete: boolean;
}

export function defaultLoginStreak(): LoginStreakData {
    return { lastLogin: '', streak: 0 };
}

/** 连续登录：断签从第 1 天重新计，满 cycleDays 天完成一个周期后下次从第 1 天开始；同一天重复记录或日期回拨不计 */
export class LoginStreak {
    constructor(private readonly options: DailyStoreOptions<LoginStreakData> & { cycleDays: number }) {
        if (!Number.isInteger(options.cycleDays) || options.cycleDays < 1) {
            throw new Error(`cycleDays 必须为正整数：${options.cycleDays}`);
        }
    }

    /** 未就绪时不计 */
    record(): LoginStreakResult {
        const data = this.options.store.get();
        if (this.options.ready && !this.options.ready())
            return { counted: false, day: data.streak, cycleComplete: false };
        const today = this.options.today();
        if (today === data.lastLogin || isRollback(data.lastLogin, today)) {
            return { counted: false, day: data.streak, cycleComplete: false };
        }
        const consecutive = data.lastLogin !== '' && dayNumber(today) - dayNumber(data.lastLogin) === 1;
        const continuing = consecutive && data.streak < this.options.cycleDays;
        const day = continuing ? data.streak + 1 : 1;
        this.options.store.set({ lastLogin: today, streak: day });
        return { counted: true, day, cycleComplete: day >= this.options.cycleDays };
    }
}
