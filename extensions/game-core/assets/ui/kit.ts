import {
    BlockInputEvents,
    Color,
    Graphics,
    HorizontalTextAlignment,
    Label,
    Node,
    UITransform,
    VerticalTextAlignment,
    view,
} from 'cc';
import { oops } from 'db://oops-framework/core/Oops';

export const THEME = {
    mask: new Color(0, 0, 0, 160),
    panel: new Color(255, 255, 255, 255),
    text: new Color(51, 51, 51, 255),
    subText: new Color(120, 120, 120, 255),
    primary: new Color(255, 136, 0, 255),
    primaryText: new Color(255, 255, 255, 255),
    secondary: new Color(230, 230, 230, 255),
    secondaryText: new Color(80, 80, 80, 255),
    banner: new Color(210, 60, 60, 235),
    radius: 20,
    fontSize: 30,
    titleSize: 36,
};

export type LayerName = 'LayerUI' | 'LayerPopUp' | 'LayerDialog' | 'LayerSystem' | 'LayerNotify';

export function getLayer(name: LayerName): Node | null {
    return oops.gui?.root?.getChildByName(name) ?? null;
}

export function visibleSize(): { width: number; height: number } {
    const size = view.getVisibleSize();
    return { width: size.width, height: size.height };
}

export function createNode(name: string, parent: Node, width = 0, height = 0): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.addComponent(UITransform).setContentSize(width, height);
    parent.addChild(node);
    return node;
}

export function fillRect(node: Node, color: Color, radius = 0) {
    const transform = node.getComponent(UITransform)!;
    const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
    const { width, height } = transform.contentSize;
    graphics.clear();
    graphics.fillColor = color;
    const x = -width * transform.anchorX;
    const y = -height * transform.anchorY;
    if (radius > 0) graphics.roundRect(x, y, width, height, radius);
    else graphics.rect(x, y, width, height);
    graphics.fill();
}

export interface LabelOptions {
    fontSize?: number;
    color?: Color;
    width?: number;
    height?: number;
    align?: 'left' | 'center' | 'right';
    wrap?: boolean;
    lineHeight?: number;
}

const ALIGN = {
    left: HorizontalTextAlignment.LEFT,
    center: HorizontalTextAlignment.CENTER,
    right: HorizontalTextAlignment.RIGHT,
};

export function addLabel(parent: Node, text: string, options: LabelOptions = {}): Label {
    const fontSize = options.fontSize ?? THEME.fontSize;
    const node = createNode('Label', parent, options.width ?? 0, options.height ?? fontSize * 1.4);
    const label = node.addComponent(Label);
    label.fontSize = fontSize;
    label.lineHeight = options.lineHeight ?? Math.round(fontSize * 1.4);
    label.color = options.color ?? THEME.text;
    label.horizontalAlign = ALIGN[options.align ?? 'center'];
    label.verticalAlign = VerticalTextAlignment.CENTER;
    if (options.width) {
        label.overflow = options.wrap ? Label.Overflow.RESIZE_HEIGHT : Label.Overflow.SHRINK;
        label.enableWrapText = Boolean(options.wrap);
    }
    label.string = text;
    return label;
}

export interface ButtonOptions {
    width?: number;
    height?: number;
    color?: Color;
    textColor?: Color;
    fontSize?: number;
}

export function addButton(parent: Node, text: string, onClick: () => void, options: ButtonOptions = {}): Node {
    const node = createNode(`Button_${text}`, parent, options.width ?? 220, options.height ?? 80);
    fillRect(node, options.color ?? THEME.primary, (options.height ?? 80) / 2);
    addLabel(node, text, {
        fontSize: options.fontSize ?? THEME.fontSize,
        color: options.textColor ?? THEME.primaryText,
        width: (options.width ?? 220) - 20,
    });
    node.on(Node.EventType.TOUCH_START, () => node.setScale(0.96, 0.96));
    node.on(Node.EventType.TOUCH_CANCEL, () => node.setScale(1, 1));
    node.on(Node.EventType.TOUCH_END, () => {
        node.setScale(1, 1);
        onClick();
    });
    return node;
}

export function setButtonText(button: Node, text: string, color?: Color) {
    const label = button.getComponentInChildren(Label);
    if (label) label.string = text;
    if (color) fillRect(button, color, button.getComponent(UITransform)!.height / 2);
}

export interface Modal {
    root: Node;
    close(): void;
}

/** 全屏遮罩并拦截下层输入 */
export function openModal(layerName: LayerName, name: string, maskColor: Color = THEME.mask): Modal | null {
    const layer = getLayer(layerName);
    if (!layer) {
        console.warn(`[game-core] 界面层 ${layerName} 不存在`);
        return null;
    }
    const { width, height } = visibleSize();
    const root = createNode(name, layer, width, height);
    fillRect(root, maskColor);
    root.addComponent(BlockInputEvents);
    return {
        root,
        close: () => destroyNow(root),
    };
}

/** 立即从父节点移除再销毁，避免当帧仍能被查找到 */
export function destroyNow(node: Node | null) {
    if (!node?.isValid) return;
    node.removeFromParent();
    node.destroy();
}

export function addPanel(parent: Node, width: number, height: number, color: Color = THEME.panel): Node {
    const panel = createNode('Panel', parent, width, height);
    fillRect(panel, color, THEME.radius);
    return panel;
}
