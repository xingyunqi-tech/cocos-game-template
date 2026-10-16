import type { Node } from 'cc';
import { THEME, addLabel, createNode, destroyNow, fillRect, getLayer, visibleSize } from './kit';

export interface OfflineBannerOptions {
    text: () => string;
    top: () => number;
}

export class OfflineBanner {
    private node: Node | null = null;

    constructor(private readonly options: OfflineBannerOptions) {}

    get visible(): boolean {
        return this.node?.isValid === true && this.node.parent !== null;
    }

    update(online: boolean) {
        if (online) this.hide();
        else this.show();
    }

    show() {
        if (this.visible) return;
        const layer = getLayer('LayerNotify');
        if (!layer) return;
        const { width, height } = visibleSize();
        const node = createNode('OfflineBanner', layer, width - 80, 64);
        fillRect(node, THEME.banner, 32);
        addLabel(node, this.options.text(), {
            fontSize: 26,
            color: THEME.primaryText,
            width: width - 120,
        });
        node.setPosition(0, height / 2 - this.options.top() - 40);
        this.node = node;
    }

    hide() {
        destroyNow(this.node);
        this.node = null;
    }
}
