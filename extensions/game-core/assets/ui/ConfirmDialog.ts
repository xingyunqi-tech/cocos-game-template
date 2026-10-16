import { UITransform } from 'cc';
import { THEME, addButton, addLabel, addPanel, fillRect, openModal, type LayerName } from './kit';

export interface ConfirmOptions {
    title?: string;
    content: string;
    confirmText?: string;
    /** 为空时只显示确认按钮 */
    cancelText?: string | null;
    layer?: LayerName;
    /** 正文下方的链接按钮 */
    links?: Array<{ text: string; onClick: () => void }>;
}

const WIDTH = 580;
const TITLE_AREA = 110;
const LINK_HEIGHT = 60;
const BUTTON_AREA = 130;

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = openModal(options.layer ?? 'LayerSystem', 'ConfirmDialog');
        if (!modal) {
            resolve(false);
            return;
        }
        const links = options.links ?? [];
        const panel = addPanel(modal.root, WIDTH, 0);
        const title = addLabel(panel, options.title ?? '提示', { fontSize: THEME.titleSize, width: WIDTH - 60 });
        const content = addLabel(panel, options.content, { width: WIDTH - 80, wrap: true });
        content.updateRenderData(true);
        const contentHeight = Math.max(content.node.getComponent(UITransform)!.height, 60);
        const height = TITLE_AREA + contentHeight + 30 + links.length * LINK_HEIGHT + BUTTON_AREA;
        panel.getComponent(UITransform)!.setContentSize(WIDTH, height);
        fillRect(panel, THEME.panel, THEME.radius);
        title.node.setPosition(0, height / 2 - 60);
        content.node.setPosition(0, height / 2 - TITLE_AREA - contentHeight / 2);
        links.forEach((link, index) => {
            const button = addButton(panel, link.text, link.onClick, {
                width: WIDTH - 120,
                height: 52,
                color: THEME.panel,
                textColor: THEME.primary,
                fontSize: 26,
            });
            button.setPosition(0, -height / 2 + BUTTON_AREA + (links.length - 1 - index) * LINK_HEIGHT + 20);
        });
        const finish = (result: boolean) => {
            modal.close();
            resolve(result);
        };
        const hasCancel = options.cancelText !== null;
        const confirm = addButton(panel, options.confirmText ?? '确定', () => finish(true));
        confirm.setPosition(hasCancel ? 130 : 0, -height / 2 + 70);
        if (hasCancel) {
            const cancel = addButton(panel, options.cancelText ?? '取消', () => finish(false), {
                color: THEME.secondary,
                textColor: THEME.secondaryText,
            });
            cancel.setPosition(-130, -height / 2 + 70);
        }
    });
}
