import { DailyCounter, defaultDailyCounter } from '../daily/DailyCounter';
import { DailyFlags, type DailyFlagsData } from '../daily/DailyFlags';
import { defaultLoginStreak, LoginStreak } from '../daily/LoginStreak';
import { Wallet, type WalletData } from '../daily/Wallet';
import type { Migration } from '../save/SaveStore';
import { isUserReady } from './auth';
import { serverTime, userSave } from './services';

const today = () => serverTime.today();

/** 以下工厂在模块顶层各调用一次，key 为 userSave 的 slot key，按服务器日期计算；用户就绪（onUserReady）前只读 */
export function createDailyCounter(key: string): DailyCounter {
    const store = userSave.slot(key, { version: 1, defaults: defaultDailyCounter });
    return new DailyCounter({ store, today, ready: isUserReady });
}

export function createDailyFlags(key: string): DailyFlags {
    const store = userSave.slot<DailyFlagsData>(key, { version: 1, defaults: () => ({}) });
    return new DailyFlags({ store, today, ready: isUserReady });
}

export function createLoginStreak(key: string, cycleDays: number): LoginStreak {
    const store = userSave.slot(key, { version: 1, defaults: defaultLoginStreak });
    return new LoginStreak({ store, today, cycleDays, ready: isUserReady });
}

export interface WalletOptions<K extends string> {
    defaults: () => WalletData<K>;
    version?: number;
    migrations?: Record<number, Migration>;
}

export function createWallet<K extends string>(key: string, options: WalletOptions<K>): Wallet<K> {
    const store = userSave.slot<WalletData<K>>(key, {
        version: options.version ?? 1,
        defaults: options.defaults,
        migrations: options.migrations,
    });
    return new Wallet<K>(store, isUserReady);
}
