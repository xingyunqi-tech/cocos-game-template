import { _decorator, Component, UITransform, Widget } from 'cc';

const { ccclass, property } = _decorator;

let provider: () => number = () => 0;

export function setSafeTopProvider(get: () => number) {
    provider = get;
}

/** 挂在顶部 UI 节点上，按平台安全区与胶囊位置下移；节点有纵向对齐的 Widget 时调整其对齐值，否则下移坐标 */
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
        const delta = offset - this.applied;
        const widget = this.getComponent(Widget);
        if (widget?.enabled && (widget.isAlignTop || widget.isAlignVerticalCenter || widget.isAlignBottom)) {
            shiftWidget(widget, delta);
        } else {
            const position = this.node.position;
            this.node.setPosition(position.x, position.y - delta, position.z);
        }
        this.applied = offset;
    }
}

function shiftWidget(widget: Widget, delta: number) {
    const target = widget.target ?? widget.node.parent;
    const height = target?.getComponent(UITransform)?.height ?? 0;
    const ratio = (absolute: boolean) => (absolute ? delta : height > 0 ? delta / height : 0);
    if (widget.isAlignTop) widget.top += ratio(widget.isAbsoluteTop);
    else if (widget.isAlignVerticalCenter) widget.verticalCenter -= ratio(widget.isAbsoluteVerticalCenter);
    else widget.bottom -= ratio(widget.isAbsoluteBottom);
    widget.updateAlignment();
}
