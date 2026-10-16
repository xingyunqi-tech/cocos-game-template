import { describe, expect, it } from 'vitest';
import { isDevVersion } from '../../scripts/check-plugins.mjs';
import { changelogBetween, compareVersions } from '../../scripts/update-core.mjs';

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
