import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_CORE_VERSION } from 'db://game-core';

describe('game-core version', () => {
    it('matches the plugin package version', () => {
        const pkg = JSON.parse(readFileSync('extensions/game-core/package.json', 'utf8'));
        expect(GAME_CORE_VERSION).toBe(pkg.version);
    });
});
