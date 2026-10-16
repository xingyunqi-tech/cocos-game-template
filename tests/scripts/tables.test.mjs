import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { convertSheet, readWorkbookTables, renderTypes } from '../../scripts/lib/tables.mjs';

const HEADER = [
    ['id', 'name', 'price', 'on', 'tags', 'extra', '#memo'],
    ['int', 'string', 'float', 'bool', 'int[]', 'json', ''],
    ['编号', '名称', '价格', '上架', '标签', '扩展', '备注'],
];

describe('convertSheet', () => {
    it('converts typed rows keyed by the first column and skips # columns and blank rows', () => {
        const table = convertSheet('item', [
            ...HEADER,
            [1001, '金币', '1.5', '是', '1,2，3', '{"a":1}', 'x'],
            [],
            [1002, { richText: [{ text: '钻' }, { text: '石' }] }, '', 'false', '', '', ''],
        ]);
        expect(table.fields.map((f) => f.name)).toEqual(['id', 'name', 'price', 'on', 'tags', 'extra']);
        expect(table.records).toEqual({
            1001: { id: 1001, name: '金币', price: 1.5, on: true, tags: [1, 2, 3], extra: { a: 1 } },
            1002: { id: 1002, name: '钻石', price: 0, on: false, tags: [], extra: null },
        });
    });

    it('reports the row and field of invalid values', () => {
        expect(() => convertSheet('item', [...HEADER, [1, 'a', 'abc']])).toThrow('item 第 4 行 price 不是合法的 float');
        expect(() => convertSheet('item', [...HEADER, [1.5, 'a']])).toThrow('第 4 行 id 不是合法的 int');
        expect(() => convertSheet('item', [...HEADER, [1, 'a', 1, 'maybe']])).toThrow('不是合法的 bool');
    });

    it('rejects duplicate keys, unknown types and invalid names', () => {
        expect(() => convertSheet('item', [...HEADER, [1], [1]])).toThrow('主键 1 重复');
        expect(() => convertSheet('item', [['id'], ['long'], []])).toThrow('类型 long 不支持');
        expect(() => convertSheet('item', [['id'], ['float'], []])).toThrow('主键类型只能是 int 或 string');
        expect(() => convertSheet('bad-name', [['id'], ['int']])).toThrow('表名');
        expect(() =>
            convertSheet('item', [
                ['#x', 'id'],
                ['', 'int'],
            ]),
        ).toThrow('第 1 列必须是主键');
    });
});

describe('renderTypes', () => {
    it('renders row interfaces and augments TableMap', () => {
        const table = convertSheet('shop_item', [...HEADER, [1, 'a']]);
        const text = renderTypes([table]);
        expect(text).toContain('export interface ShopItemRow {');
        expect(text).toContain('    /** 价格 */\n    price: number;');
        expect(text).toContain('    tags: number[];');
        expect(text).toContain("declare module 'db://game-core/config/Tables'");
        expect(text).toContain('        shop_item: ShopItemRow;');
    });
});

describe('cell values', () => {
    const header = [['id', 'name', 'n', 'list'], ['string', 'string', 'int', 'int[]'], []];
    const convert = (row) => convertSheet('t', [...header, row]);

    it('reads formula results, hyperlinks, rich text and dates', () => {
        const table = convert([
            { formula: 'A1', result: 'k1' },
            { text: { richText: [{ text: ' 链 ' }, { text: '接 ' }] }, hyperlink: 'https://x' },
            { sharedFormula: 'C4', result: 3 },
            '',
        ]);
        expect(table.records.k1).toEqual({ id: 'k1', name: '链 接', n: 3, list: [] });
        expect(convert([new Date(Date.UTC(2026, 0, 1)), 'x']).records['2026-01-01T00:00:00.000Z']).toBeTruthy();
    });

    it('reports formulas without results and error values', () => {
        expect(() => convert(['k', { formula: 'A1' }])).toThrow('t 第 4 行 name 公式没有缓存结果');
        expect(() => convert(['k', { error: '#DIV/0!' }])).toThrow('单元格错误 #DIV/0!');
    });

    it('rejects hex ints and empty array elements', () => {
        expect(() => convert(['k', 'a', '0x10'])).toThrow('不是合法的 int');
        expect(() => convert(['k', 'a', 1, '1,2,'])).toThrow('list[2] 为空');
    });

    it('accepts keys that collide with object prototype names', () => {
        const table = convertSheet('t', [...header, ['toString', 'a'], ['constructor', 'b']]);
        expect(Object.keys(table.records)).toEqual(['toString', 'constructor']);
    });

    it('rejects duplicate fields and conflicting type names', () => {
        expect(() =>
            convertSheet('t', [
                ['id', 'a', 'a'],
                ['int', 'int', 'int'],
            ]),
        ).toThrow('字段 a 重复');
        const a = convertSheet('a_b', [['id'], ['int']]);
        const b = convertSheet('aB', [['id'], ['int']]);
        expect(() => renderTypes([a, b])).toThrow('类型名 ABRow 冲突');
    });
});

describe('xlsx reading', () => {
    it('reads the sample workbook through readWorkbookTables', async () => {
        const tables = await readWorkbookTables(join(import.meta.dirname, '../../config-tables/demo.xlsx'), ExcelJS);
        expect(tables.map((t) => t.name)).toEqual(['demo_level']);
        expect(tables[0].records[1]).toMatchObject({ id: 1, duration: 20, tags: ['新手', '默认'] });
    });
});
