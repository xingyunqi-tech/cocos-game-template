import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            { find: /^cc\/env$/, replacement: path('./tests/stubs/cc-env.ts') },
            { find: /^cc$/, replacement: path('./tests/stubs/cc.ts') },
            { find: /^db:\/\/game-core$/, replacement: path('./extensions/game-core/assets/index.ts') },
            { find: /^db:\/\/game-core\/(.*)$/, replacement: path('./extensions/game-core/assets/$1') },
            {
                find: /^db:\/\/oops-framework\/(.*)$/,
                replacement: path('./extensions/oops-plugin-framework/assets/$1'),
            },
        ],
    },
    test: {
        include: ['tests/**/*.test.{ts,mjs}'],
    },
});
