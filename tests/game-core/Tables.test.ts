import { describe, expect, it } from 'vitest';
import { TableStore } from 'db://game-core/config/Tables';

describe('TableStore', () => {
    it('gets rows by numeric or string id and lists all rows', () => {
        const store = new TableStore();
        store.set('demo_level', { 1: { id: 1, name: 'a' }, 2: { id: 2, name: 'b' } });
        expect(store.get('demo_level', 1)).toMatchObject({ name: 'a' });
        expect(store.get('demo_level', '2')).toMatchObject({ name: 'b' });
        expect(store.get('demo_level', 3)).toBeUndefined();
        expect(store.all('demo_level')).toHaveLength(2);
        expect(store.names).toEqual(['demo_level']);
    });

    it('ignores object prototype names', () => {
        const store = new TableStore();
        store.set('demo_level', { 1: { id: 1 } });
        expect(store.get('demo_level', 'toString')).toBeUndefined();
        expect(store.has('constructor')).toBe(false);
        expect(() => store.get('constructor' as 'demo_level', 1)).toThrow('未加载');
    });

    it('throws for tables that are not loaded', () => {
        expect(() => new TableStore().get('demo_level', 1)).toThrow('配置表 demo_level 未加载');
    });
});
