import { basename, extname, join } from 'node:path';

export const FIELD_TYPES = {
    int: 'number',
    float: 'number',
    string: 'string',
    bool: 'boolean',
    json: 'unknown',
    'int[]': 'number[]',
    'float[]': 'number[]',
    'string[]': 'string[]',
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function cellText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        if (own(value, 'error')) throw new Error(`单元格错误 ${value.error}`);
        if (own(value, 'formula') || own(value, 'sharedFormula')) {
            if (!own(value, 'result')) throw new Error('公式没有缓存结果，请用 Excel 打开并保存');
            return cellText(value.result);
        }
        if (own(value, 'result')) return cellText(value.result);
        if (own(value, 'richText'))
            return value.richText
                .map((part) => part.text)
                .join('')
                .trim();
        if (own(value, 'text')) return cellText(value.text);
    }
    return String(value).trim();
}

function readCell(raw, where) {
    try {
        return cellText(raw);
    } catch (err) {
        throw new Error(`${where} ${err.message}`, { cause: err });
    }
}

const INT = /^[-+]?\d+$/;
const FLOAT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function parseValue(raw, type, where) {
    const text = readCell(raw, where);
    switch (type) {
        case 'int':
        case 'float': {
            if (text === '') return 0;
            if (!(type === 'int' ? INT : FLOAT).test(text)) throw new Error(`${where} 不是合法的 ${type}：${text}`);
            return Number(text);
        }
        case 'bool':
            if (text === '') return false;
            if (/^(true|1|是)$/i.test(text)) return true;
            if (/^(false|0|否)$/i.test(text)) return false;
            throw new Error(`${where} 不是合法的 bool：${text}`);
        case 'string':
            return text;
        case 'json':
            if (text === '') return null;
            try {
                return JSON.parse(text);
            } catch {
                throw new Error(`${where} 不是合法的 JSON：${text}`);
            }
        default: {
            const item = type.slice(0, -2);
            if (text === '') return [];
            return text.split(/[,，|]/).map((part, i) => {
                if (part.trim() === '') throw new Error(`${where}[${i}] 为空，检查是否多写了分隔符`);
                return parseValue(part.trim(), item, `${where}[${i}]`);
            });
        }
    }
}

/** 第 1 行字段名、第 2 行类型、第 3 行说明，第 4 行起为数据；第 1 列为主键 */
export function convertSheet(name, rows) {
    if (!NAME.test(name)) throw new Error(`表名 ${name} 只能包含字母、数字、下划线`);
    const [header = [], types = [], notes = []] = rows;
    const fields = [];
    header.forEach((cell, col) => {
        const field = readCell(cell, `${name} 第 ${col + 1} 列字段名`);
        if (!field || field.startsWith('#')) return;
        if (!NAME.test(field)) throw new Error(`${name} 第 ${col + 1} 列字段名 ${field} 不合法`);
        if (fields.some((f) => f.name === field)) throw new Error(`${name} 字段 ${field} 重复`);
        const type = readCell(types[col], `${name}.${field} 类型`);
        if (!(type in FIELD_TYPES)) throw new Error(`${name}.${field} 类型 ${type || '（空）'} 不支持`);
        fields.push({ name: field, type, note: readCell(notes[col], `${name}.${field} 说明`), col });
    });
    if (fields.length === 0 || fields[0].col !== 0) throw new Error(`${name} 第 1 列必须是主键`);
    if (!['int', 'string'].includes(fields[0].type)) throw new Error(`${name} 主键类型只能是 int 或 string`);

    const records = Object.create(null);
    rows.slice(3).forEach((row, index) => {
        const line = index + 4;
        if (!row || readCell(row[0], `${name} 第 ${line} 行主键`) === '') return;
        const record = {};
        for (const field of fields)
            record[field.name] = parseValue(row[field.col], field.type, `${name} 第 ${line} 行 ${field.name}`);
        const id = String(record[fields[0].name]);
        if (own(records, id)) throw new Error(`${name} 第 ${line} 行主键 ${id} 重复`);
        records[id] = record;
    });
    return { name, fields, records: { ...records } };
}

function typeName(name) {
    return `${name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}Row`;
}

export function renderTypes(tables) {
    const seen = new Map();
    for (const table of tables) {
        const type = typeName(table.name);
        if (seen.has(type)) throw new Error(`表 ${seen.get(type)} 与 ${table.name} 生成的类型名 ${type} 冲突`);
        seen.set(type, table.name);
    }
    const lines = ['// 由 npm run tables 生成，不要手改', ''];
    for (const table of tables) {
        lines.push(`export interface ${typeName(table.name)} {`);
        for (const field of table.fields) {
            if (field.note) lines.push(`    /** ${field.note.replace(/\*\//g, '* /')} */`);
            lines.push(`    ${field.name}: ${FIELD_TYPES[field.type]};`);
        }
        lines.push('}', '');
    }
    lines.push("declare module 'db://game-core/config/Tables' {", '    interface TableMap {');
    for (const table of tables) lines.push(`        ${table.name}: ${typeName(table.name)};`);
    lines.push('    }', '}', '');
    return lines.join('\n');
}

export async function readWorkbookTables(file, ExcelJS) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const tables = [];
    const sheets = [];
    workbook.eachSheet((sheet) => sheets.push(sheet));
    for (const sheet of sheets) {
        if (sheet.name.startsWith('#')) continue;
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (row, number) => {
            rows[number - 1] = (row.values ?? []).slice(1);
        });
        try {
            tables.push(
                convertSheet(
                    sheet.name,
                    Array.from(rows, (row) => row ?? []),
                ),
            );
        } catch (err) {
            throw new Error(`${basename(file)}：${err.message}`, { cause: err });
        }
    }
    return tables;
}

/** 由全部表计算输出：JSON 文件内容、类型文件内容、需删除的过期 JSON；表名重复或类型名冲突时抛错，不写任何文件 */
export function planTables(tables, { jsonDir, typesFile, existingJson }) {
    const names = new Set();
    for (const table of tables) {
        if (names.has(table.name)) throw new Error(`表名 ${table.name} 重复`);
        names.add(table.name);
    }
    const types = renderTypes(tables);
    const writes = tables.map((table) => ({
        name: table.name,
        rows: Object.keys(table.records).length,
        path: join(jsonDir, `${table.name}.json`),
        content: `${JSON.stringify(table.records, null, 2)}\n`,
    }));
    writes.push({ path: typesFile, content: types });
    const stale = existingJson.filter((file) => extname(file) === '.json' && !names.has(basename(file, '.json')));
    return { writes, stale: stale.map((file) => join(jsonDir, file)) };
}
