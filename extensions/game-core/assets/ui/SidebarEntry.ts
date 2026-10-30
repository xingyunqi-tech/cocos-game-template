import type { Node } from 'cc';
import type { ConfirmOptions } from './ConfirmDialog';
import { addButton, THEME } from './kit';
import { coreText } from './strings';

export interface SidebarEntryOptions {
    isSupported: () => Promise<boolean>;
    open: () => Promise<boolean>;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    text: string;
    rewardText: string;
}

/** 抖音侧边栏入口按钮；平台不支持时不创建 */
export async function createSidebarEntry(parent: Node, options: SidebarEntryOptions): Promise<Node | null> {
    if (!(await options.isSupported())) return null;
    if (!parent.isValid) return null;
    const button = addButton(
        parent,
        options.text,
        () => {
            void options
                .confirm({
                    title: coreText.sidebarTitle,
                    content: options.rewardText,
                    confirmText: coreText.sidebarGo,
                    cancelText: coreText.cancel,
                })
                .then((go) => {
                    if (go) void options.open();
                });
        },
        { width: 160, height: 64, color: THEME.primary, fontSize: 26 },
    );
    button.name = 'SidebarEntry';
    return button;
}
