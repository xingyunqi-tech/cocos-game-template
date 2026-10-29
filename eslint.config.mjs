import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const GLOBAL_THIS = {
    selector: "Identifier[name='globalThis']",
    message: '禁止直接访问 globalThis，平台能力通过 db://game-core 使用',
};

const GAME_CORE_INTERNAL = {
    group: ['db://game-core/*', '!db://game-core/augment', '**/game-core/assets/**'],
    message: '只能使用 db://game-core 的公开接口',
};

export default tseslint.config(
    {
        ignores: [
            'extensions/oops-plugin-framework/**',
            'library/**',
            'temp/**',
            'local/**',
            'build/**',
            'profiles/**',
            'tests/stubs/**',
            '**/*.d.ts',
        ],
    },
    {
        files: ['**/*.mjs'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['**/*.mts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['scripts/smoke-web.mjs', 'scripts/smoke-game.mjs'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['**/*.ts'],
        extends: tseslint.configs.recommendedTypeChecked,
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
    },
    {
        files: ['assets/game/**/*.ts', 'assets/bundles/**/*.ts'],
        rules: {
            'no-restricted-globals': ['error', 'wx', 'tt', 'window'],
            'no-restricted-syntax': ['error', GLOBAL_THIS],
            '@typescript-eslint/no-restricted-imports': ['error', { patterns: [GAME_CORE_INTERNAL] }],
        },
    },
    {
        files: ['extensions/game-core/**/*.ts'],
        rules: {
            '@typescript-eslint/no-restricted-imports': [
                'error',
                { patterns: [{ group: ['**/assets/game/**'], message: 'game-core 不能依赖业务层' }] },
            ],
        },
    },
);
