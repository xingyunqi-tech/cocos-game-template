import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/cocos.mjs';

const LOCK_DIR = join(ROOT, 'scripts/plugin-locks');
const IGNORED = new Set(['node_modules', '.DS_Store']);

function listFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full));
        else out.push(full);
    }
    return out;
}

export function snapshot(pluginDir) {
    const files = {};
    for (const file of listFiles(pluginDir).sort()) {
        const key = relative(pluginDir, file).split(sep).join('/');
        files[key] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
    return files;
}

export function diff(locked, actual) {
    const changed = [];
    for (const [file, hash] of Object.entries(locked)) {
        if (!(file in actual)) changed.push(`缺失 ${file}`);
        else if (actual[file] !== hash) changed.push(`修改 ${file}`);
    }
    for (const file of Object.keys(actual)) if (!(file in locked)) changed.push(`新增 ${file}`);
    return changed;
}

function main() {
    const { values } = parseArgs({
        options: { update: { type: 'string' }, source: { type: 'string' } },
    });

    if (values.update) {
        const pluginDir = join(ROOT, 'extensions', values.update);
        if (!existsSync(pluginDir)) throw new Error(`插件不存在：${pluginDir}`);
        const lock = { plugin: values.update, source: values.source ?? '', files: snapshot(pluginDir) };
        writeFileSync(join(LOCK_DIR, `${values.update}.json`), `${JSON.stringify(lock, null, 2)}\n`);
        console.log(`已更新锁定：${values.update}（${Object.keys(lock.files).length} 个文件）`);
        return;
    }

    let failed = false;
    for (const name of readdirSync(LOCK_DIR).filter((f) => f.endsWith('.json'))) {
        const lock = JSON.parse(readFileSync(join(LOCK_DIR, name), 'utf8'));
        const pluginDir = join(ROOT, 'extensions', lock.plugin);
        const changes = existsSync(pluginDir) ? diff(lock.files, snapshot(pluginDir)) : ['插件目录不存在'];
        if (changes.length === 0) {
            console.log(`✓ ${lock.plugin}（${lock.source}）`);
            continue;
        }
        failed = true;
        console.error(`✗ ${lock.plugin} 与锁定不一致：`);
        for (const line of changes.slice(0, 30)) console.error(`  ${line}`);
    }
    process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
