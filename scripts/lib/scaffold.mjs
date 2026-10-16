const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** game-core 在 userSave 中已占用的 slot key */
export const RESERVED_SLOT_KEYS = ['sidebar'];

export function pascalCase(name) {
    return name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
}

export function camelCase(name) {
    const pascal = pascalCase(name);
    return pascal[0].toLowerCase() + pascal.slice(1);
}

/** 生成业务模块骨架：存档模型、界面与公开入口 */
export function moduleFiles(name) {
    if (!NAME.test(name)) throw new Error(`模块名 ${name} 只能是小写字母、数字与连字符，如 shop、daily-task`);
    const Pascal = pascalCase(name);
    const camel = camelCase(name);
    if (RESERVED_SLOT_KEYS.includes(camel))
        throw new Error(`模块名 ${name} 与 game-core 的存档 key 冲突，请换一个名字`);
    return {
        [`${Pascal}Model.ts`]: `import { userSave } from 'db://game-core';

export interface ${Pascal}Data {
    version: number;
}

const slot = userSave.slot<${Pascal}Data>('${camel}', { version: 1, defaults: () => ({ version: 1 }) });

export const ${camel}Model = {
    get: (): Readonly<${Pascal}Data> => slot.get(),
    update: (mutate: (data: ${Pascal}Data) => void) => slot.update(mutate),
};
`,
        [`${Pascal}View.ts`]: `import { addButton, addLabel, addPanel, openModal, THEME } from 'db://game-core';
import { ${camel}Model } from './${Pascal}Model';

const WIDTH = 600;
const HEIGHT = 700;

export function open${Pascal}View() {
    const modal = openModal('LayerDialog', '${Pascal}View');
    if (!modal) return null;
    const panel = addPanel(modal.root, WIDTH, HEIGHT);
    addLabel(panel, '${Pascal}', { fontSize: THEME.titleSize, width: WIDTH - 60 }).node.setPosition(0, HEIGHT / 2 - 60);
    addLabel(panel, \`数据版本 \${${camel}Model.get().version}\`, { width: WIDTH - 60 }).node.setPosition(0, 0);
    addButton(panel, '关闭', () => modal.close()).setPosition(0, -HEIGHT / 2 + 70);
    return modal;
}
`,
        'index.ts': `export { ${camel}Model } from './${Pascal}Model';
export type { ${Pascal}Data } from './${Pascal}Model';
export { open${Pascal}View } from './${Pascal}View';
`,
    };
}
