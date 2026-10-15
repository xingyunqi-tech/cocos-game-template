import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from 'db://game-core/save/KeyValueStore';
import { migrate, SaveStore, utf8Bytes } from 'db://game-core/save/SaveStore';

interface Profile {
    level: number;
    coins: number;
    name: string;
}

function setup(extra: Partial<ConstructorParameters<typeof SaveStore>[0]> = {}) {
    const store = new MemoryStore();
    const scheduled: Array<() => void> = [];
    const save = new SaveStore({
        store,
        prefix: 'gc:u',
        schedule: (fn) => {
            scheduled.push(fn);
            return scheduled.length;
        },
        cancelSchedule: () => undefined,
        ...extra,
    });
    return { store, save, scheduled };
}

const profile = { version: 2, defaults: (): Profile => ({ level: 1, coins: 0, name: '' }) };

describe('migrate', () => {
    it('applies migrations step by step', () => {
        const result = migrate({ v: 1, d: { lv: 3 } }, 3, {
            2: (d) => ({ level: d.lv }),
            3: (d) => ({ ...d, coins: 10 }),
        });
        expect(result).toEqual({ level: 3, coins: 10 });
    });

    it('returns undefined when a migration step is missing or the data is newer', () => {
        expect(migrate({ v: 1, d: {} }, 3, { 2: (d) => d })).toBeUndefined();
        expect(migrate({ v: 4, d: {} }, 3)).toBeUndefined();
    });
});

describe('SaveStore', () => {
    it('returns defaults when nothing is stored', () => {
        const { save } = setup();
        expect(save.slot('profile', profile).get()).toEqual({ level: 1, coins: 0, name: '' });
    });

    it('writes after the throttle tick and reads back with the version envelope', () => {
        const { save, store, scheduled } = setup();
        save.slot('profile', profile).update((p) => (p.level = 5));
        expect(store.getItem('gc:u:profile')).toBeNull();
        scheduled.shift()?.();
        expect(JSON.parse(store.getItem('gc:u:profile')!)).toEqual({ v: 2, d: { level: 5, coins: 0, name: '' } });
        expect(save.slot('profile', profile).get().level).toBe(5);
    });

    it('flush writes pending data immediately', () => {
        const { save, store } = setup();
        save.slot('profile', profile).update((p) => (p.coins = 9));
        save.flush();
        expect((JSON.parse(store.getItem('gc:u:profile')!) as { d: Profile }).d.coins).toBe(9);
    });

    it('isolates scopes per user', () => {
        const { save, store } = setup();
        save.setScope('u1');
        save.slot('profile', profile).update((p) => (p.name = 'a'));
        save.setScope('u2');
        expect(save.slot('profile', profile).get().name).toBe('');
        expect((JSON.parse(store.getItem('gc:u:u1:profile')!) as { d: Profile }).d.name).toBe('a');
    });

    it('migrates old data and falls back to defaults on corrupt data', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        store.setItem('gc:u:old', JSON.stringify({ v: 1, d: { lv: 7 } }));
        store.setItem('gc:u:broken', '{oops');
        const migrated = save.slot('old', { ...profile, migrations: { 2: (d) => ({ level: d.lv }) } }).get();
        expect(migrated).toEqual({ level: 7, coins: 0, name: '' });
        expect(save.slot('broken', profile).get()).toEqual(profile.defaults());
        expect(onWarn).toHaveBeenCalledWith('存档解析失败，使用默认值', expect.objectContaining({ key: 'broken' }));
    });

    it('clearScope removes only keys written under the current scope', () => {
        const { save, store } = setup();
        store.setItem('unrelated', 'keep');
        save.setScope('u1');
        save.slot('a', profile).set(profile.defaults());
        save.setScope('u2');
        save.slot('b', profile).set(profile.defaults());
        save.flush();
        save.clearScope();
        expect(store.getItem('gc:u:u2:b')).toBeNull();
        expect(store.getItem('gc:u:u1:a')).not.toBeNull();
        expect(store.getItem('unrelated')).toBe('keep');
    });

    it('warns when a document exceeds the size threshold', () => {
        const onWarn = vi.fn();
        const { save } = setup({ onWarn, warnBytes: 50 });
        save.slot('profile', profile).update((p) => (p.name = 'x'.repeat(100)));
        save.flush();
        expect(onWarn).toHaveBeenCalledWith('存档体积超过阈值', expect.objectContaining({ key: 'gc:u:profile' }));
    });
});

describe('SaveStore edge cases', () => {
    it('invalidates a long-lived slot when the scope changes', () => {
        const { save, store } = setup();
        const slot = save.slot('profile', profile);
        save.setScope('u1');
        slot.update((p) => (p.name = 'alice'));
        save.setScope('u2');
        expect(slot.get().name).toBe('');
        slot.update((p) => (p.name = 'bob'));
        save.flush();
        expect((JSON.parse(store.getItem('gc:u:u1:profile')!) as { d: Profile }).d.name).toBe('alice');
        expect((JSON.parse(store.getItem('gc:u:u2:profile')!) as { d: Profile }).d.name).toBe('bob');
    });

    it('invalidates slot caches after clearScope', () => {
        const { save } = setup();
        save.setScope('u1');
        const slot = save.slot('profile', profile);
        slot.update((p) => (p.coins = 5));
        save.flush();
        save.clearScope();
        expect(slot.get().coins).toBe(0);
    });

    it('round-trips arrays and primitives without merging defaults', () => {
        const { save } = setup();
        save.slot<string[]>('inv', { version: 1, defaults: () => [] }).set(['sword']);
        save.slot<number>('best', { version: 1, defaults: () => 0 }).set(42);
        save.flush();
        expect(save.slot<string[]>('inv', { version: 1, defaults: () => [] }).get()).toEqual(['sword']);
        expect(save.slot<number>('best', { version: 1, defaults: () => 0 }).get()).toBe(42);
    });

    it('treats empty strings from mini-game storage as missing without warning', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        store.setItem('gc:u:profile', '');
        expect(save.slot('profile', profile).get()).toEqual(profile.defaults());
        expect(onWarn).not.toHaveBeenCalled();
    });

    it('falls back to defaults for invalid envelopes and throwing migrations', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        store.setItem('gc:u:a', 'null');
        store.setItem('gc:u:b', JSON.stringify({ v: 1, d: null }));
        store.setItem('gc:u:c', JSON.stringify({ v: 1, d: { x: 1 } }));
        expect(save.slot('a', profile).get()).toEqual(profile.defaults());
        expect(save.slot('b', { ...profile, migrations: { 2: (d) => d } }).get()).toEqual(profile.defaults());
        const throwing = {
            ...profile,
            migrations: {
                2: () => {
                    throw new Error('bad');
                },
            },
        };
        expect(save.slot('c', throwing).get()).toEqual(profile.defaults());
        expect(onWarn).toHaveBeenCalledTimes(3);
    });

    it('keeps writing other keys when one write throws and retains the failed key', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        const original = store.setItem.bind(store);
        store.setItem = (key, value) => {
            if (key === 'gc:u:a') throw new Error('QuotaExceeded');
            original(key, value);
        };
        save.slot('a', profile).set(profile.defaults());
        save.slot('b', profile).set(profile.defaults());
        expect(save.flush()).toBe(false);
        expect(store.getItem('gc:u:b')).not.toBeNull();
        expect(onWarn).toHaveBeenCalledWith('存档写入失败', { key: 'gc:u:a', error: 'QuotaExceeded' });
        store.setItem = original;
        expect(save.flush()).toBe(true);
        expect(store.getItem('gc:u:a')).not.toBeNull();
    });

    it('clearScope without a scope keeps scoped user data', () => {
        const { save, store } = setup();
        save.setScope('u1');
        save.slot('a', profile).set(profile.defaults());
        save.setScope('');
        save.slot('shared', profile).set(profile.defaults());
        save.flush();
        save.clearScope();
        expect(store.getItem('gc:u:u1:a')).not.toBeNull();
        expect(store.getItem('gc:u:shared')).toBeNull();
    });

    it('warns on access before a required scope is set', () => {
        const onWarn = vi.fn();
        const { save } = setup({ onWarn, requireScope: true });
        save.slot('profile', profile).get();
        expect(onWarn).toHaveBeenCalledWith('未设置存档作用域时读取', { key: 'profile' });
    });

    it('measures size in UTF-8 bytes', () => {
        expect(utf8Bytes('ab')).toBe(2);
        expect(utf8Bytes('中文')).toBe(6);
        expect(utf8Bytes('😀')).toBe(4);
    });
});
