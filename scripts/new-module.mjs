import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/cocos.mjs';
import { moduleFiles } from './lib/scaffold.mjs';

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string', default: join(ROOT, 'assets', 'game') } },
});
const [name] = positionals;
if (!name) {
    console.error('用法：npm run new:module -- <模块名>，如 npm run new:module -- shop');
    process.exit(1);
}
let files;
try {
    files = moduleFiles(name);
} catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
}
const target = join(values.dir, name);
if (existsSync(target)) {
    console.error(`✗ 目录已存在：${relative(ROOT, target)}`);
    process.exit(1);
}
mkdirSync(target, { recursive: true });
for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(target, file), content);
    console.log(`✓ ${relative(ROOT, join(target, file))}`);
}
