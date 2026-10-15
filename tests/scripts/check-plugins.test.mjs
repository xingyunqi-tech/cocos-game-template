import { describe, expect, it } from 'vitest';
import { diff } from '../../scripts/check-plugins.mjs';

describe('check-plugins diff', () => {
    it('reports nothing for identical snapshots', () => {
        expect(diff({ 'a.ts': '1' }, { 'a.ts': '1' })).toEqual([]);
    });

    it('reports modified, missing and added files', () => {
        expect(diff({ 'a.ts': '1', 'b.ts': '2' }, { 'a.ts': 'x', 'c.ts': '3' })).toEqual([
            '修改 a.ts',
            '缺失 b.ts',
            '新增 c.ts',
        ]);
    });
});
