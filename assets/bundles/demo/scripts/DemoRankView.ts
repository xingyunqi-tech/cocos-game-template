import { _decorator, Component, Label, Node } from 'cc';
import { oops } from 'db://oops-framework/core/Oops';
import type { RankParams } from '../../../game/demo/ui';

const { ccclass, property } = _decorator;

/** prefab 界面组件：节点在 prefab 中摆放，通过 @property 引用；oops.gui.open 的 data 在 onAdded 中接收 */
@ccclass('DemoRankView')
export class DemoRankView extends Component {
    @property(Label)
    title: Label | null = null;

    @property(Label)
    list: Label | null = null;

    @property(Node)
    closeButton: Node | null = null;

    onLoad() {
        this.closeButton?.on(Node.EventType.TOUCH_END, () => oops.gui.removeByNode(this.node));
    }

    onAdded(params: RankParams) {
        if (this.title) this.title.string = `最高分 ${params.best}`;
        if (this.list) {
            this.list.string =
                params.recent.length > 0
                    ? params.recent.map((score, i) => `第 ${i + 1} 局    ${score} 分`).join('\n')
                    : '还没有成绩，先玩一局吧';
        }
    }
}
