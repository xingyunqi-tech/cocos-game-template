import { _decorator, Component, Widget } from 'cc';

const { ccclass, property } = _decorator;

let provider: () => number = () => 0;

export function setSafeTopProvider(get: () => number) {
    provider = get;
}

/** 挂在顶部 UI 节点上，按平台安全区与胶囊位置下移；有 Widget 时调整 top，否则下移坐标 */
@ccclass('SafeTopAdapter')
export class SafeTopAdapter extends Component {
    @property
    extra = 0;

    private applied = 0;

    onEnable() {
        this.apply();
    }

    apply() {
        const offset = provider() + this.extra;
        const widget = this.getComponent(Widget);
        if (widget?.isAlignTop && widget.isAbsoluteTop) {
            widget.top += offset - this.applied;
            widget.updateAlignment();
        } else {
            const position = this.node.position;
            this.node.setPosition(position.x, position.y - (offset - this.applied), position.z);
        }
        this.applied = offset;
    }
}
