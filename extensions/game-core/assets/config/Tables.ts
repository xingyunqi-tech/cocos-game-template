import type { TableMap } from '../augment';

export type { TableMap };

export type TableName = Exclude<keyof TableMap, '__tables'>;

const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export class TableStore {
    private tables: Record<string, Record<string, unknown>> = {};

    set(name: string, records: Record<string, unknown>) {
        this.tables[name] = records;
    }

    has(name: string): boolean {
        return own(this.tables, name);
    }

    get names(): string[] {
        return Object.keys(this.tables);
    }

    get<K extends TableName>(name: K, id: string | number): NonNullable<TableMap[K]> | undefined {
        const table = this.table(name);
        const key = String(id);
        return (own(table, key) ? table[key] : undefined) as NonNullable<TableMap[K]> | undefined;
    }

    all<K extends TableName>(name: K): Array<NonNullable<TableMap[K]>> {
        return Object.values(this.table(name)) as Array<NonNullable<TableMap[K]>>;
    }

    private table(name: string): Record<string, unknown> {
        if (!own(this.tables, name)) throw new Error(`配置表 ${name} 未加载`);
        return this.tables[name];
    }
}

export const Tables = new TableStore();
