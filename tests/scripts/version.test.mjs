import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('game-core version', () => {
    it('matches the plugin package version', () => {
        const pkg = JSON.parse(readFileSync('extensions/game-core/package.json', 'utf8'));
        const index = readFileSync('extensions/game-core/assets/index.ts', 'utf8');
        expect(/GAME_CORE_VERSION = '([^']+)'/.exec(index)?.[1]).toBe(pkg.version);
    });
});
