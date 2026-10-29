import { describe, expect, it, vi } from 'vitest';
import { DailyCounter, defaultDailyCounter, type DailyCounterData } from 'db://game-core/daily/DailyCounter';
import { DailyFlags, type DailyFlagsData } from 'db://game-core/daily/DailyFlags';
import { dayNumber, isRollback } from 'db://game-core/daily/date';
import { defaultLoginStreak, LoginStreak, type LoginStreakData } from 'db://game-core/daily/LoginStreak';
import { Wallet, type WalletData } from 'db://game-core/daily/Wallet';

function memory<T>(initial: T) {
    let value = initial;
    return { get: () => value, set: (next: T) => void (value = next) };
}

function calendar(start: string) {
    let date = start;
    return { today: () => date, go: (next: string) => void (date = next) };
}

describe('date helpers', () => {
    it('counts days and detects rollback', () => {
        expect(dayNumber('1970-01-02')).toBe(1);
        expect(dayNumber('2026-03-01') - dayNumber('2026-02-28')).toBe(1);
        expect(isRollback('', '2026-10-28')).toBe(false);
        expect(isRollback('2026-10-28', '2026-10-27')).toBe(true);
        expect(isRollback('2026-10-28', '2026-10-28')).toBe(false);
        expect(isRollback('2026-10-30', '2026-10-28')).toBe(true);
        expect(isRollback('2026-10-31', '2026-10-28')).toBe(false);
    });
});

describe('DailyCounter', () => {
    it('limits uses per key per day and resets on the next day', () => {
        const day = calendar('2026-10-28');
        const counter = new DailyCounter({ store: memory<DailyCounterData>(defaultDailyCounter()), today: day.today });
        expect(counter.tryUse('revive', 1)).toBe(true);
        expect(counter.tryUse('revive', 1)).toBe(false);
        expect(counter.tryUse('chest', 3)).toBe(true);
        expect(counter.remaining('chest', 3)).toBe(2);
        day.go('2026-10-29');
        expect(counter.uses('revive')).toBe(0);
        expect(counter.tryUse('revive', 1)).toBe(true);
    });

    it('keeps the recorded counts when the date rolls back', () => {
        const day = calendar('2026-10-28');
        const store = memory<DailyCounterData>(defaultDailyCounter());
        const counter = new DailyCounter({ store, today: day.today });
        counter.record('revive');
        day.go('2026-10-27');
        expect(counter.uses('revive')).toBe(1);
        expect(counter.tryUse('revive', 1)).toBe(false);
        counter.record('chest');
        expect(store.get()).toEqual({ date: '2026-10-28', counts: { revive: 1, chest: 1 } });
    });

    it('resets counts recorded on a date more than two days ahead', () => {
        const day = calendar('2027-03-01');
        const counter = new DailyCounter({ store: memory<DailyCounterData>(defaultDailyCounter()), today: day.today });
        counter.record('revive');
        day.go('2026-10-28');
        expect(counter.tryUse('revive', 1)).toBe(true);
    });

    it('rejects invalid counts and treats everything as used before ready', () => {
        let ready = false;
        const counter = new DailyCounter({
            store: memory<DailyCounterData>(defaultDailyCounter()),
            today: () => '2026-10-28',
            ready: () => ready,
        });
        expect(() => counter.record('a', -1)).toThrow('计数必须为正整数');
        expect(() => counter.record('a', NaN)).toThrow('计数必须为正整数');
        expect(counter.tryUse('a', 1)).toBe(false);
        counter.record('a');
        ready = true;
        expect(counter.uses('a')).toBe(0);
    });
});

describe('DailyFlags', () => {
    it('claims each flag once per day and never on a rolled back date', () => {
        const day = calendar('2026-10-28');
        const flags = new DailyFlags({ store: memory<DailyFlagsData>({}), today: day.today });
        expect(flags.claim('firstWin')).toBe(true);
        expect(flags.claim('firstWin')).toBe(false);
        expect(flags.canClaim('challenge')).toBe(true);
        day.go('2026-10-27');
        expect(flags.canClaim('firstWin')).toBe(false);
        day.go('2026-10-29');
        expect(flags.claim('firstWin')).toBe(true);
    });

    it('drops flags older than the rollback window when claiming', () => {
        const day = calendar('2026-10-01');
        const store = memory<DailyFlagsData>({});
        const flags = new DailyFlags({ store, today: day.today });
        flags.claim('level:1');
        day.go('2026-10-28');
        flags.claim('level:2');
        expect(store.get()).toEqual({ 'level:2': '2026-10-28' });
    });
});

describe('LoginStreak', () => {
    const streak = (cycleDays = 3) => {
        const day = calendar('2026-10-28');
        return {
            day,
            streak: new LoginStreak({
                store: memory<LoginStreakData>(defaultLoginStreak()),
                today: day.today,
                cycleDays,
            }),
        };
    };

    it('counts consecutive days and completes a cycle', () => {
        const { day, streak: s } = streak();
        expect(s.record()).toEqual({ counted: true, day: 1, cycleComplete: false });
        expect(s.record()).toEqual({ counted: false, day: 1, cycleComplete: false });
        day.go('2026-10-29');
        expect(s.record().day).toBe(2);
        day.go('2026-10-30');
        expect(s.record()).toEqual({ counted: true, day: 3, cycleComplete: true });
        day.go('2026-10-31');
        expect(s.record()).toEqual({ counted: true, day: 1, cycleComplete: false });
    });

    it('restarts after a missed day and ignores rolled back dates', () => {
        const { day, streak: s } = streak();
        s.record();
        day.go('2026-10-29');
        s.record();
        day.go('2026-10-27');
        expect(s.record()).toEqual({ counted: false, day: 2, cycleComplete: false });
        day.go('2026-11-01');
        expect(s.record().day).toBe(1);
    });

    it('requires a positive whole number of cycle days', () => {
        expect(() => streak(0)).toThrow('cycleDays 必须为正整数');
        expect(() => streak(2.5)).toThrow('cycleDays 必须为正整数');
    });
});

describe('Wallet', () => {
    type Key = 'coins' | 'hint';
    const wallet = () => new Wallet<Key>(memory<WalletData<Key>>({ coins: 100, hint: 0 }));

    it('adds, spends and exchanges without going below zero', () => {
        const w = wallet();
        w.add('coins', 50);
        expect(w.spend('coins', 200)).toBe(false);
        expect(w.exchange('coins', 60, 'hint')).toBe(true);
        expect([w.get('coins'), w.get('hint')]).toEqual([90, 1]);
        expect(w.exchange('coins', 100, 'hint')).toBe(false);
        expect(w.spend('hint')).toBe(true);
        expect(w.spend('hint')).toBe(false);
        expect(() => w.add('coins', -1)).toThrow('add 只接受有限非负数');
        expect(() => w.add('coins', Infinity)).toThrow('add 只接受有限非负数');
        expect(w.spend('coins', NaN)).toBe(false);
        expect(w.exchange('coins', NaN, 'hint')).toBe(false);
        expect(w.get('coins')).toBe(90);
    });

    it('notifies changes with the new amount and delta', () => {
        const w = wallet();
        const listener = vi.fn();
        const off = w.onChange(listener);
        w.exchange('coins', 30, 'hint', 2);
        expect(listener.mock.calls).toEqual([
            ['coins', 70, -30],
            ['hint', 2, 2],
        ]);
        off();
        w.add('coins', 1);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
