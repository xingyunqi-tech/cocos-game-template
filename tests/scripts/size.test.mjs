import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLimits, measurePackage } from '../../scripts/lib/size.mjs';

let dirs = [];

function fixture(files, game = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'size-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'game.json'), JSON.stringify(game));
    for (const [path, bytes] of Object.entries(files)) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), Buffer.alloc(bytes));
    }
    return dir;
}

afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
});

describe('measurePackage', () => {
    it('splits main package, subpackages and remote assets', () => {
        const game = { subpackages: [{ name: 'level', root: 'subpackages/level/' }] };
        const dir = fixture(
            { 'game.js': 100, 'assets/main/index.js': 200, 'subpackages/level/a.js': 300, 'remote/big/b.bin': 999 },
            game,
        );
        const measure = measurePackage(dir);
        expect(measure.main).toBe(100 + 200 + JSON.stringify(game).length);
        expect(measure.subpackages).toEqual([
            { name: 'level', root: 'subpackages/level/', independent: false, bytes: 300 },
        ]);
        expect(measure.excluded).toBe(999);
        expect(measure.total).toBe(measure.main + 300);
    });

    it('accepts roots without a trailing slash', () => {
        const dir = fixture({ 'sub/x.js': 10 }, { subpackages: [{ root: './sub' }] });
        expect(measurePackage(dir).subpackages[0]).toMatchObject({ name: './sub', bytes: 10 });
    });
});

describe('checkLimits', () => {
    const limits = { main: 100, subpackage: null, independent: 50, total: 300 };

    it('passes within limits and ignores unlimited subpackages', () => {
        const measure = { main: 100, total: 300, subpackages: [{ name: 'a', bytes: 200, independent: false }] };
        expect(checkLimits(measure, limits)).toEqual([]);
    });

    it('reports every exceeded limit', () => {
        const measure = {
            main: 101,
            total: 400,
            subpackages: [{ name: 'ind', bytes: 51, independent: true }],
        };
        expect(checkLimits(measure, limits).map((v) => v.label)).toEqual(['主包', '分包 ind', '总包']);
    });
});
