import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineConfigPath, ROOT } from './lib/cocos.mjs';

const STUB_TRUE = new Set(['DEBUG', 'DEV', 'HTML5', 'TEST']);

const constants = JSON.parse(readFileSync(engineConfigPath(), 'utf8')).constants;
const names = Object.keys(constants).sort();
const typeOf = (name) => (constants[name].type === 'number' ? 'number' : 'boolean');

const declaration = [
    "declare module 'cc/env' {",
    ...names.map((name) => `    export const ${name}: ${typeOf(name)};`),
    '}',
    '',
].join('\n');

const stub = [
    ...names.map((name) => {
        const value = typeOf(name) === 'number' ? (constants[name].value ?? 0) : STUB_TRUE.has(name);
        return `export const ${name} = ${JSON.stringify(value)};`;
    }),
    '',
].join('\n');

writeFileSync(join(ROOT, 'types/cc-env.d.ts'), declaration);
writeFileSync(join(ROOT, 'tests/stubs/cc-env.ts'), stub);
console.log(`cc/env：${names.length} 个常量`);
