import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { ROOT } from './lib/cocos.mjs';
import { planTables, readWorkbookTables } from './lib/tables.mjs';

const { values } = parseArgs({
    options: {
        input: { type: 'string', default: join(ROOT, 'config-tables') },
        json: { type: 'string', default: join(ROOT, 'assets', 'resources', 'tables') },
        types: { type: 'string', default: join(ROOT, 'assets', 'game', 'tables', 'TableTypes.ts') },
        check: { type: 'boolean', default: false },
    },
});

const files = existsSync(values.input)
    ? readdirSync(values.input).filter((f) => extname(f) === '.xlsx' && !basename(f).startsWith('~$'))
    : [];
let plan;
try {
    const tables = [];
    for (const file of files) tables.push(...(await readWorkbookTables(join(values.input, file), ExcelJS)));
    plan = planTables(tables, {
        jsonDir: values.json,
        typesFile: values.types,
        existingJson: existsSync(values.json) ? readdirSync(values.json) : [],
    });
} catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
}

const show = (path) => relative(ROOT, path);

if (values.check) {
    const outdated = plan.writes
        .filter(({ path, content }) => !existsSync(path) || readFileSync(path, 'utf8') !== content)
        .map(({ path }) => path)
        .concat(plan.stale);
    if (outdated.length === 0) {
        console.log('✓ 配置表生成物与 Excel 一致');
        process.exit(0);
    }
    for (const path of outdated) console.error(`✗ ${show(path)} 与 Excel 不一致`);
    console.error('执行 npm run tables 重新生成');
    process.exit(1);
}

for (const { path, content, name, rows } of plan.writes) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(name ? `✓ ${name}：${rows} 行 → ${basename(path)}` : `✓ 类型 → ${path}`);
}
for (const path of plan.stale) {
    rmSync(path);
    rmSync(`${path}.meta`, { force: true });
    console.log(`- 删除过期表 ${basename(path)}`);
}
