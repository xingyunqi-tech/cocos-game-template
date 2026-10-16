import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { ROOT } from './lib/cocos.mjs';
import { readWorkbookTables, renderTypes } from './lib/tables.mjs';

const { values } = parseArgs({
    options: {
        input: { type: 'string', default: join(ROOT, 'config-tables') },
        json: { type: 'string', default: join(ROOT, 'assets', 'resources', 'tables') },
        types: { type: 'string', default: join(ROOT, 'assets', 'game', 'tables', 'TableTypes.ts') },
    },
});

const files = readdirSync(values.input).filter((f) => extname(f) === '.xlsx' && !basename(f).startsWith('~$'));
const tables = [];
try {
    for (const file of files) tables.push(...(await readWorkbookTables(join(values.input, file), ExcelJS)));
} catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
}
const names = new Set();
for (const table of tables) {
    if (names.has(table.name)) {
        console.error(`✗ 表名 ${table.name} 重复`);
        process.exit(1);
    }
    names.add(table.name);
}

mkdirSync(values.json, { recursive: true });
for (const file of readdirSync(values.json)) {
    if (extname(file) !== '.json' || names.has(basename(file, '.json'))) continue;
    rmSync(join(values.json, file));
    rmSync(join(values.json, `${file}.meta`), { force: true });
    console.log(`- 删除过期表 ${file}`);
}
for (const table of tables) {
    writeFileSync(join(values.json, `${table.name}.json`), `${JSON.stringify(table.records, null, 2)}\n`);
    console.log(`✓ ${table.name}：${Object.keys(table.records).length} 行 → ${table.name}.json`);
}
let types;
try {
    types = renderTypes(tables);
} catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
}
mkdirSync(join(values.types, '..'), { recursive: true });
writeFileSync(values.types, types);
console.log(`✓ 类型 → ${values.types}`);
