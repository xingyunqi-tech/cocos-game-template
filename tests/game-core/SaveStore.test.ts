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

function reopen(store: MemoryStore, extra: Partial<ConstructorParameters<typeof SaveStore>[0]> = {}) {
    return new SaveStore({ store, prefix: 'gc:u', ...extra });
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
        expect(reopen(store).slot('profile', profile).get().level).toBe(5);
    });

    it('flush writes pending data immediately', () => {
        const { save, store } = setup();
        save.slot('profile', profile).update((p) => (p.coins = 9));
        save.flush();
        expect((JSON.parse(store.getItem('gc:u:profile')!) as { d: Profile }).d.coins).toBe(9);
    });

    it('isolates scopes per user', () => {
        const { save, store } = setup();
        const slot = save.slot('profile', profile);
        save.setScope('u1');
        slot.update((p) => (p.name = 'a'));
        save.setScope('u2');
        expect(slot.get().name).toBe('');
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

describe('SaveStore adoptScope', () => {
    function withGuestSave() {
        const ctx = setup();
        const slot = ctx.save.slot('profile', profile);
        ctx.save.setScope('guest-d1');
        slot.update((p) => (p.level = 5));
        ctx.save.slot('extra', profile).set(profile.defaults());
        ctx.save.flush();
        return { ...ctx, slot };
    }

    it('tells whether a scope has written or pending data', () => {
        const { save, store, slot } = withGuestSave();
        expect(save.hasData('guest-d1')).toBe(true);
        expect(save.hasData('7')).toBe(false);
        expect(save.hasData('')).toBe(false);
        save.setScope('8');
        slot.set(profile.defaults());
        expect(save.hasData('8')).toBe(true);
        store.setItem('gc:u:9:profile', JSON.stringify({ v: 2, d: {} }));
        expect(save.hasData('9')).toBe(true);
    });

    it('does not adopt into a scope whose save is missing from the index', () => {
        const { save, store } = withGuestSave();
        const own = JSON.stringify({ v: 2, d: { level: 9 } });
        store.setItem('gc:u:7:profile', own);
        save.setScope('7');
        expect(save.adoptScope('guest-d1')).toBe(false);
        expect(store.getItem('gc:u:7:profile')).toBe(own);
    });

    it('moves the guest save into an empty current scope and removes the source', () => {
        const { save, store, slot } = withGuestSave();
        save.setScope('7');
        expect(slot.get().level).toBe(1);
        expect(save.adoptScope('guest-d1')).toBe(true);
        expect(slot.get().level).toBe(5);
        expect(store.getItem('gc:u:7:extra')).not.toBeNull();
        expect(store.getItem('gc:u:guest-d1:profile')).toBeNull();
        expect(store.getItem('gc:u:guest-d1:extra')).toBeNull();
        save.clearScope();
        expect(store.getItem('gc:u:7:profile')).toBeNull();
    });

    it('keeps both saves when the current scope already has data', () => {
        const { save, store, slot } = withGuestSave();
        save.setScope('7');
        slot.update((p) => (p.level = 2));
        expect(save.adoptScope('guest-d1')).toBe(false);
        expect(slot.get().level).toBe(2);
        expect(store.getItem('gc:u:guest-d1:profile')).not.toBeNull();
    });

    it('does nothing without a source save, without a scope, or for the same scope', () => {
        const { save } = withGuestSave();
        save.setScope('7');
        expect(save.adoptScope('guest-other')).toBe(false);
        save.setScope('guest-d1');
        expect(save.adoptScope('guest-d1')).toBe(false);
        save.setScope('');
        expect(save.adoptScope('guest-d1')).toBe(false);
    });

    it('does not take keys from nested scopes', () => {
        const { save, store } = setup();
        store.setItem('gc:u:guest-d1:sub:x', JSON.stringify({ v: 2, d: {} }));
        store.setItem('gc:u:__index', JSON.stringify(['gc:u:guest-d1:sub:x']));
        save.setScope('7');
        expect(save.adoptScope('guest-d1')).toBe(false);
        expect(store.getItem('gc:u:guest-d1:sub:x')).not.toBeNull();
    });

    it('rolls back the copied keys and keeps the source when a write fails', () => {
        const { store } = withGuestSave();
        const onWarn = vi.fn();
        const reopened = reopen(store, { onWarn });
        reopened.setScope('7');
        const setItem = store.setItem.bind(store);
        let writes = 0;
        vi.spyOn(store, 'setItem').mockImplementation((key, value) => {
            if (key.startsWith('gc:u:7:') && ++writes === 2) throw new Error('full');
            setItem(key, value);
        });
        expect(reopened.adoptScope('guest-d1')).toBe(false);
        expect(store.getItem('gc:u:7:profile')).toBeNull();
        expect(store.getItem('gc:u:7:extra')).toBeNull();
        expect(store.getItem('gc:u:guest-d1:profile')).not.toBeNull();
        expect(onWarn).toHaveBeenCalledWith('存档迁移写入失败', expect.objectContaining({ error: 'full' }));
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
        const { save, store } = setup();
        save.slot<string[]>('inv', { version: 1, defaults: () => [] }).set(['sword']);
        save.slot<number>('best', { version: 1, defaults: () => 0 }).set(42);
        save.flush();
        const reopened = reopen(store);
        expect(reopened.slot<string[]>('inv', { version: 1, defaults: () => [] }).get()).toEqual(['sword']);
        expect(reopened.slot<number>('best', { version: 1, defaults: () => 0 }).get()).toBe(42);
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

    it('throws when a key is registered twice', () => {
        const { save } = setup();
        save.slot('profile', profile);
        expect(() => save.slot('profile', profile)).toThrow('存档 key 重复注册：profile');
    });

    it('reads defaults for data newer than the slot version and never writes over it', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        const newer = JSON.stringify({ v: 3, d: { level: 9, coins: 999, name: 'x' } });
        store.setItem('gc:u:profile', newer);
        const slot = save.slot('profile', profile);
        expect(slot.get()).toEqual(profile.defaults());
        slot.update((p) => (p.coins = 1));
        slot.update((p) => (p.coins = 2));
        save.flush();
        expect(slot.get().coins).toBe(2);
        expect(store.getItem('gc:u:profile')).toBe(newer);
        expect(onWarn).toHaveBeenCalledWith('存档版本高于当前代码，使用默认值且不写入', {
            key: 'profile',
            from: 3,
            to: 2,
        });
        expect(onWarn).toHaveBeenCalledWith('存档版本高于当前代码，不写入', { key: 'profile', to: 2 });
        expect(onWarn).toHaveBeenCalledTimes(2);
    });

    it('does not write over newer data when setting without reading first', () => {
        const { save, store } = setup();
        const newer = JSON.stringify({ v: 3, d: { level: 9 } });
        store.setItem('gc:u:profile', newer);
        save.slot('profile', profile).set(profile.defaults());
        save.flush();
        expect(store.getItem('gc:u:profile')).toBe(newer);
    });

    it('writes again after newer data is reset', () => {
        const { save, store } = setup();
        store.setItem('gc:u:profile', JSON.stringify({ v: 3, d: {} }));
        const slot = save.slot('profile', profile);
        slot.get();
        slot.reset();
        slot.set(profile.defaults());
        save.flush();
        expect((JSON.parse(store.getItem('gc:u:profile')!) as { v: number }).v).toBe(2);
    });

    it('never writes over data that has no migration path', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        const old = JSON.stringify({ v: 1, d: { level: 5, coins: 50, name: 'a' } });
        store.setItem('gc:u:profile', old);
        const slot = save.slot('profile', profile);
        expect(slot.get()).toEqual(profile.defaults());
        slot.update((p) => (p.coins = 1));
        save.flush();
        expect(store.getItem('gc:u:profile')).toBe(old);
        expect(onWarn).toHaveBeenCalledWith('存档版本无法迁移，使用默认值且不写入', { key: 'profile', from: 1, to: 2 });
        expect(onWarn).toHaveBeenCalledWith('存档版本无法迁移，不写入', { key: 'profile', to: 2 });
    });

    it('never writes over data whose migration throws, even when setting without reading first', () => {
        const onWarn = vi.fn();
        const { save, store } = setup({ onWarn });
        const old = JSON.stringify({ v: 1, d: { level: 5 } });
        store.setItem('gc:u:profile', old);
        const migrations = {
            2: () => {
                throw new Error('bad');
            },
        };
        save.slot('profile', { ...profile, migrations }).set(profile.defaults());
        save.flush();
        expect(store.getItem('gc:u:profile')).toBe(old);
        expect(onWarn).toHaveBeenCalledWith('存档版本无法迁移，使用默认值且不写入', {
            key: 'profile',
            from: 1,
            to: 2,
            error: 'bad',
        });
    });

    it('backs up a primitive value on a version bump and then writes again', () => {
        const { save, store } = setup();
        const old = JSON.stringify({ v: 1, d: 5 });
        store.setItem('gc:u:best', old);
        const slot = save.slot<number>('best', { version: 2, defaults: () => 0, migrations: { 2: (d) => d } });
        expect(slot.get()).toBe(0);
        expect(store.getItem('gc:u:__bak:best')).toBe(old);
        slot.set(7);
        save.flush();
        expect(JSON.parse(store.getItem('gc:u:best')!)).toEqual({ v: 2, d: 7 });
    });

    it('backs up unparsable data and then writes new data', () => {
        const { save, store } = setup();
        store.setItem('gc:u:profile', '{broken');
        const slot = save.slot('profile', profile);
        expect(slot.get()).toEqual(profile.defaults());
        expect(store.getItem('gc:u:__bak:profile')).toBe('{broken');
        slot.update((p) => (p.coins = 3));
        save.flush();
        expect(JSON.parse(store.getItem('gc:u:profile')!)).toEqual({ v: 2, d: { level: 1, coins: 3, name: '' } });
    });

    it('stores backups of scoped data outside every scope', () => {
        const { save, store } = setup();
        save.setScope('u1');
        store.setItem('gc:u:u1:profile', 'null');
        save.slot('profile', profile).get();
        expect(store.getItem('gc:u:__bak:u1:profile')).toBe('null');
        save.clearScope();
        expect(store.getItem('gc:u:__bak:u1:profile')).toBe('null');
    });

    it('measures size in UTF-8 bytes', () => {
        expect(utf8Bytes('ab')).toBe(2);
        expect(utf8Bytes('中文')).toBe(6);
        expect(utf8Bytes('😀')).toBe(4);
    });
});
