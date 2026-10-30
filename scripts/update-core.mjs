import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { diff, snapshot } from './check-plugins.mjs';
import { loadLocalEnv, ROOT } from './lib/cocos.mjs';

const CORE_DIR = join('extensions', 'game-core');
const LOCK_FILE = join('scripts', 'plugin-locks', 'game-core.json');

export function compareVersions(a, b) {
    const parse = (v) =>
        v
            .split('-')[0]
            .split('.')
            .map((n) => Number(n) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
}

/** 返回版本高于 from、不高于 to 的 CHANGELOG 小节 */
export function changelogBetween(text, from, to) {
    return text
        .split(/^## /m)
        .slice(1)
        .map((section) => ({ version: section.split(/[（(\s]/)[0], body: `## ${section.trim()}` }))
        .filter(
            ({ version }) =>
                /^\d+\.\d+\.\d+/.test(version) &&
                compareVersions(version, to) <= 0 &&
                (!from || compareVersions(version, from) > 0),
        )
        .map(({ body }) => body);
}

/** 本地 game-core 与当前锁定快照的差异；没有锁定时返回 null */
export function localChanges(root = ROOT) {
    const lockFile = join(root, LOCK_FILE);
    if (!existsSync(lockFile) || !existsSync(join(root, CORE_DIR))) return null;
    return diff(JSON.parse(readFileSync(lockFile, 'utf8')).files, snapshot(join(root, CORE_DIR)));
}

/** 用 source 中的 game-core 与锁定文件替换 root 中的；失败时恢复原插件并清理临时目录 */
export function installCore(source, root = ROOT, rename = renameSync) {
    const target = join(root, CORE_DIR);
    const old = `${target}.old`;
    const staged = `${target}.next`;
    const lock = join(root, LOCK_FILE);
    const stagedLock = `${lock}.next`;
    rmSync(old, { recursive: true, force: true });
    try {
        cpSync(join(source, CORE_DIR), staged, { recursive: true });
        cpSync(join(source, LOCK_FILE), stagedLock);
        const hadTarget = existsSync(target);
        if (hadTarget) rename(target, old);
        let installed = false;
        try {
            rename(staged, target);
            installed = true;
            rename(stagedLock, lock);
        } catch (err) {
            try {
                if (installed) rmSync(target, { recursive: true, force: true });
                if (hadTarget) rename(old, target);
            } catch (restoreErr) {
                throw new Error(
                    `替换 game-core 失败（${err.message}），恢复也失败（${restoreErr.message}）：原插件在 ${old}，关闭编辑器后再次运行本脚本会自动恢复`,
                    { cause: restoreErr },
                );
            }
            throw err;
        }
    } finally {
        rmSync(staged, { recursive: true, force: true });
        rmSync(stagedLock, { force: true });
    }
    rmSync(old, { recursive: true, force: true });
}

function readVersion(dir) {
    const file = join(dir, CORE_DIR, 'package.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).version ?? '') : '';
}

function main() {
    loadLocalEnv();
    const { positionals, values } = parseArgs({
        allowPositionals: true,
        options: {
            source: { type: 'string', default: process.env.GAME_CORE_SOURCE },
            force: { type: 'boolean', default: false },
            'allow-downgrade': { type: 'boolean', default: false },
        },
    });
    const [version] = positionals;
    if (!version || !values.source) {
        console.error(
            '用法：scripts/update-core.sh <版本号> --source <模板仓库地址或本地路径>（或设置 GAME_CORE_SOURCE）',
        );
        process.exit(1);
    }
    const target = join(ROOT, CORE_DIR);
    const old = `${target}.old`;
    if (!existsSync(target) && existsSync(old)) {
        renameSync(old, target);
        console.log(`! 已从 ${CORE_DIR}.old 恢复上次未完成升级前的 game-core`);
    }
    const before = readVersion(ROOT);
    if (before && compareVersions(version, before) < 0 && !values['allow-downgrade']) {
        console.error(`✗ 目标版本 ${version} 低于当前 ${before}，确认降级请加 --allow-downgrade`);
        process.exit(1);
    }
    const changes = localChanges();
    if (changes && changes.length > 0 && !values.force) {
        console.error(`✗ 本地 game-core 与锁定快照有 ${changes.length} 处差异，升级会覆盖这些修改：`);
        for (const line of changes.slice(0, 20)) console.error(`  ${line}`);
        console.error('先把修改提交到模板仓库，或加 --force 覆盖');
        process.exit(1);
    }
    const tag = `core-v${version}`;
    const work = mkdtempSync(join(tmpdir(), 'game-core-'));
    try {
        execFileSync(
            'git',
            [
                '-c',
                'advice.detachedHead=false',
                'clone',
                '--quiet',
                '--depth',
                '1',
                '--branch',
                tag,
                values.source,
                work,
            ],
            {
                stdio: 'inherit',
            },
        );
        const fetched = readVersion(work);
        if (fetched !== version) throw new Error(`${tag} 中 game-core 版本为 ${fetched}，与 ${version} 不一致`);
        if (!existsSync(join(work, LOCK_FILE))) throw new Error(`${tag} 中缺少 ${LOCK_FILE}`);
        installCore(work);
        console.log(`✓ game-core ${before || '（无）'} → ${version}`);
        const notes = changelogBetween(readFileSync(join(ROOT, CORE_DIR, 'CHANGELOG.md'), 'utf8'), before, version);
        if (notes.length > 0) {
            console.log('\n以下版本的变更需要确认，其中「项目侧资源」需手工合入：\n');
            console.log(notes.join('\n\n'));
        }
        execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-plugins.mjs')], { stdio: 'inherit' });
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

if (process.argv[1] && process.argv[1].endsWith('update-core.mjs')) {
    try {
        main();
    } catch (err) {
        console.error(`✗ ${err.message}`);
        process.exit(1);
    }
}
