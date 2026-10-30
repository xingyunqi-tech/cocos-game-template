import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDevVersion, snapshot } from '../../scripts/check-plugins.mjs';
import { changelogBetween, compareVersions, installCore, restoreInterrupted } from '../../scripts/update-core.mjs';

const LOG = `# game-core 变更记录

## 1.1.0（2026-11-01）

- 新功能

## 1.0.0（2026-10-15）

- 首个版本

### 项目侧资源

- config.json

## 0.5.0（未发布）

- 旧
`;

describe('changelogBetween', () => {
    it('returns sections newer than the current version up to the target', () => {
        const notes = changelogBetween(LOG, '0.5.0', '1.1.0');
        expect(notes.map((n) => n.split('\n')[0])).toEqual(['## 1.1.0（2026-11-01）', '## 1.0.0（2026-10-15）']);
        expect(notes[1]).toContain('### 项目侧资源');
    });

    it('starts from the target version when upgrading partway', () => {
        expect(changelogBetween(LOG, '0.5.0', '1.0.0').map((n) => n.split('\n')[0])).toEqual([
            '## 1.0.0（2026-10-15）',
        ]);
    });

    it('returns nothing when already at the target', () => {
        expect(changelogBetween(LOG, '1.1.0', '1.1.0')).toEqual([]);
    });

    it('compares versions numerically when the current version is missing from the log', () => {
        expect(changelogBetween(LOG, '0.9.0', '1.0.0').map((n) => n.split('\n')[0])).toEqual([
            '## 1.0.0（2026-10-15）',
        ]);
        expect(changelogBetween(LOG, '', '1.0.0')).toHaveLength(2);
        expect(changelogBetween('## 1.10.0\n\n## 1.1.0\n', '1.0.0', '1.1.0')).toEqual(['## 1.1.0']);
    });
});

describe('versions', () => {
    it('compares semantic versions', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
        expect(compareVersions('1.0.0', '1.0.0-dev')).toBe(0);
        expect(compareVersions('0.5.0', '1.0.0')).toBe(-1);
    });

    it('recognizes dev versions', () => {
        expect(isDevVersion('1.0.1-dev')).toBe(true);
        expect(isDevVersion('1.0.1-dev.2')).toBe(true);
        expect(isDevVersion('1.0.1')).toBe(false);
    });
});

describe('installCore', () => {
    function fixture() {
        const base = mkdtempSync(join(tmpdir(), 'install-core-'));
        const write = (root, version) => {
            mkdirSync(join(root, 'extensions', 'game-core'), { recursive: true });
            mkdirSync(join(root, 'scripts', 'plugin-locks'), { recursive: true });
            writeFileSync(join(root, 'extensions', 'game-core', 'package.json'), JSON.stringify({ version }));
            writeFileSync(join(root, 'scripts', 'plugin-locks', 'game-core.json'), JSON.stringify({ version }));
        };
        const source = join(base, 'source');
        const root = join(base, 'root');
        write(source, '2.0.0');
        write(root, '1.0.0');
        const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8')).version;
        const leftovers = () =>
            readdirSync(join(root, 'extensions')).concat(readdirSync(join(root, 'scripts', 'plugin-locks')));
        return { base, source, root, read, leftovers };
    }

    it('replaces the plugin and its lock file', () => {
        const { base, source, root, read, leftovers } = fixture();
        installCore(source, root);
        expect(read('extensions/game-core/package.json')).toBe('2.0.0');
        expect(read('scripts/plugin-locks/game-core.json')).toBe('2.0.0');
        expect(leftovers()).toEqual(['game-core', 'game-core.json']);
        rmSync(base, { recursive: true, force: true });
    });

    it.each([1, 2, 3])('restores the original plugin when rename %i fails', (failing) => {
        const { base, source, root, read, leftovers } = fixture();
        let calls = 0;
        const rename = (from, to) => {
            if (++calls === failing) throw new Error('EPERM');
            renameSync(from, to);
        };
        expect(() => installCore(source, root, rename)).toThrow('EPERM');
        expect(read('extensions/game-core/package.json')).toBe('1.0.0');
        expect(read('scripts/plugin-locks/game-core.json')).toBe('1.0.0');
        expect(leftovers()).toEqual(['game-core', 'game-core.json']);
        rmSync(base, { recursive: true, force: true });
    });

    it('reports where the original plugin is when restoring it also fails', () => {
        const { base, source, root } = fixture();
        let calls = 0;
        const rename = (from, to) => {
            if (++calls >= 2) throw new Error(`EPERM ${calls}`);
            renameSync(from, to);
        };
        expect(() => installCore(source, root, rename)).toThrow(/EPERM 2.*EPERM 3.*game-core\.old/);
        expect(readdirSync(join(root, 'extensions'))).toEqual(['game-core.old']);
        rmSync(base, { recursive: true, force: true });
    });

    function lockCurrent(root) {
        const files = snapshot(join(root, 'extensions/game-core'));
        writeFileSync(join(root, 'scripts/plugin-locks/game-core.json'), JSON.stringify({ version: '1.0.0', files }));
    }

    it('restores an interrupted upgrade only when the plugin directory is gone', () => {
        const { base, root, read } = fixture();
        lockCurrent(root);
        expect(restoreInterrupted(root)).toBeNull();
        renameSync(join(root, 'extensions/game-core'), join(root, 'extensions/game-core.old'));
        mkdirSync(join(root, 'extensions/game-core'));
        expect(restoreInterrupted(root)).toBe('conflict');
        expect(readdirSync(join(root, 'extensions')).sort()).toEqual(['game-core', 'game-core.old']);
        rmSync(join(root, 'extensions/game-core'), { recursive: true });
        expect(restoreInterrupted(root)).toBe('restored');
        expect(read('extensions/game-core/package.json')).toBe('1.0.0');
        rmSync(base, { recursive: true, force: true });
    });

    it('removes a leftover backup when the plugin matches its lock', () => {
        const { base, root } = fixture();
        lockCurrent(root);
        cpSync(join(root, 'extensions/game-core'), join(root, 'extensions/game-core.old'), { recursive: true });
        expect(restoreInterrupted(root)).toBe('cleaned');
        expect(readdirSync(join(root, 'extensions'))).toEqual(['game-core']);
        rmSync(base, { recursive: true, force: true });
    });
});
