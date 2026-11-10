import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const GLOBAL_THIS = {
    selector: "Identifier[name='globalThis']",
    message: '禁止直接访问 globalThis，平台能力通过 db://game-core 使用',
};

const arraySpreadOnly = {
    meta: {
        type: 'problem',
        messages: {
            spread: 'Cocos 构建使用 Babel loose 模式，只能展开或解构数组；Set、Map、迭代器先用 Array.from 转换',
        },
        schema: [],
    },
    create(context) {
        const services = context.sourceCode.parserServices;
        const checker = services.program.getTypeChecker();
        const isArrayLike = (type) => {
            const resolved = checker.getBaseConstraintOfType(type) ?? type;
            if (resolved.isUnion()) return resolved.types.every(isArrayLike);
            if (resolved.isIntersection()) return resolved.types.some(isArrayLike);
            return checker.isArrayType(resolved) || checker.isTupleType(resolved);
        };
        const check = (node, target) => {
            const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(target));
            if (!isArrayLike(type)) context.report({ node, messageId: 'spread' });
        };
        return {
            SpreadElement(node) {
                if (node.parent.type !== 'ObjectExpression') check(node, node.argument);
            },
            'VariableDeclarator[id.type="ArrayPattern"]'(node) {
                if (node.init) check(node.id, node.init);
            },
            'AssignmentExpression[left.type="ArrayPattern"]'(node) {
                check(node.left, node.right);
            },
        };
    },
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
        files: ['assets/**/*.ts', 'extensions/game-core/**/*.ts'],
        plugins: { cocos: { rules: { 'array-spread-only': arraySpreadOnly } } },
        rules: { 'cocos/array-spread-only': 'error' },
    },
    {
        files: ['assets/game/**/*.ts', 'assets/bundles/**/*.ts'],
        rules: {
            'no-restricted-globals': ['error', 'wx', 'tt', 'window', 'self'],
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
