import { Mask, ScrollView, TextAsset, UITransform, resources } from 'cc';
import { THEME, addButton, addLabel, createNode, getLayer, openModal } from './kit';
import { coreText } from './strings';
import { splitLines } from './text';

export type LegalDocument = 'privacy' | 'agreement';

export const LEGAL_DOCUMENTS: Record<LegalDocument, { title: string; path: string }> = {
    privacy: { title: '隐私政策', path: 'legal/privacy' },
    agreement: { title: '用户协议', path: 'legal/agreement' },
};

function loadText(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        resources.load(path, TextAsset, (err, asset) => (err ? reject(err) : resolve(asset.text)));
    });
}

export interface DocumentPageOptions {
    top: () => number;
    extraAction?: { text: string; onClick: () => void } | null;
}

/** 全屏展示 resources 下的协议文本，System 层 */
export async function openDocument(kind: LegalDocument, options: DocumentPageOptions): Promise<void> {
    if (getLayer('LayerSystem')?.getChildByName(`Document_${kind}`)) return;
    const modal = openModal('LayerSystem', `Document_${kind}`, THEME.panel);
    if (!modal) return;
    const root = modal.root;
    const { width, height } = root.getComponent(UITransform)!.contentSize;
    const top = options.top();

    const title = addLabel(root, LEGAL_DOCUMENTS[kind].title, { fontSize: THEME.titleSize, width: width - 240 });
    title.node.setPosition(0, height / 2 - top - 40);
    const close = addButton(root, coreText.back, () => modal.close(), {
        width: 120,
        height: 60,
        color: THEME.secondary,
        textColor: THEME.secondaryText,
        fontSize: 26,
    });
    close.setPosition(-width / 2 + 90, height / 2 - top - 40);

    const bottom = options.extraAction ? 120 : 40;
    const viewHeight = height - top - 100 - bottom;
    const viewport = createNode('Viewport', root, width - 60, viewHeight);
    viewport.setPosition(0, height / 2 - top - 90 - viewHeight / 2);
    viewport.addComponent(Mask);
    const content = createNode('Content', viewport, width - 60, viewHeight);
    content.getComponent(UITransform)!.setAnchorPoint(0.5, 1);
    content.setPosition(0, viewHeight / 2);
    const textWidth = width - 60;
    const render = (body: string) => {
        content.destroyAllChildren();
        content.removeAllChildren();
        let cursor = 0;
        for (const line of splitLines(body)) {
            if (line === '') {
                cursor += PARAGRAPH_GAP;
                continue;
            }
            const label = addLabel(content, line, { fontSize: 26, width: textWidth, wrap: true, align: 'left' });
            const transform = label.node.getComponent(UITransform)!;
            transform.setAnchorPoint(0.5, 1);
            label.updateRenderData(true);
            label.node.setPosition(0, -cursor);
            cursor += transform.height;
        }
        content.getComponent(UITransform)!.setContentSize(textWidth, Math.max(viewHeight, cursor));
    };
    render(coreText.loading);
    const scroll = viewport.addComponent(ScrollView);
    scroll.horizontal = false;
    scroll.content = content;

    if (options.extraAction) {
        const extra = options.extraAction;
        const button = addButton(root, extra.text, extra.onClick, { width: width - 120, height: 72 });
        button.setPosition(0, -height / 2 + 70);
    }

    let body: string;
    try {
        body = await loadText(LEGAL_DOCUMENTS[kind].path);
    } catch (err) {
        body = coreText.documentFailed;
        console.warn('[game-core] 协议文本加载失败', err);
    }
    if (!root.parent) return;
    render(body);
    scroll.scrollToTop();
}

const PARAGRAPH_GAP = 18;
