import { Color, type Label } from 'cc';
import { THEME, addLabel, createNode, fillRect, openModal, visibleSize, type Modal } from '../ui/kit';
import { coreText } from '../ui/strings';
import { HEALTH_NOTICE } from './health';

export interface HealthNoticeOptions {
    /** 适龄提示文字，null 不显示；正式版本需替换为后台确定的适龄提示图标 */
    ageRating: string | null;
    /** 刘海与状态栏避让，设计分辨率单位 */
    safeTop: () => number;
}

const BACKGROUND = new Color(24, 28, 40, 255);
const LIGHT = new Color(230, 230, 230, 255);
const AGE_COLOR = new Color(46, 160, 67, 255);

/** 启动加载页：健康游戏忠告、适龄提示与加载进度 */
export class HealthNotice {
    private modal: Modal | null = null;
    private progress: Label | null = null;
    private shownAt = 0;

    show(options: HealthNoticeOptions) {
        if (this.visible) return;
        this.modal = openModal('LayerSystem', 'HealthNotice', BACKGROUND);
        if (!this.modal) return;
        this.shownAt = Date.now();
        const root = this.modal.root;
        const { width, height } = visibleSize();
        if (options.ageRating) {
            const badge = createNode('AgeRating', root, 120, 140);
            fillRect(badge, AGE_COLOR, 16);
            addLabel(badge, options.ageRating, { fontSize: 44, color: THEME.primaryText, width: 110 }).node.setPosition(
                0,
                18,
            );
            addLabel(badge, coreText.ageRating, {
                fontSize: 20,
                color: THEME.primaryText,
                width: 110,
            }).node.setPosition(0, -38);
            badge.setPosition(-width / 2 + 90, height / 2 - options.safeTop() - 90);
        }
        this.progress = addLabel(root, coreText.loading, { fontSize: 28, color: LIGHT, width: width - 80 });
        this.progress.node.setPosition(0, -height / 2 + 360);
        HEALTH_NOTICE.forEach((line, index) => {
            const label = addLabel(root, line, { fontSize: 24, color: LIGHT, width: width - 80 });
            label.node.setPosition(0, -height / 2 + 250 - index * 40);
        });
        addLabel(root, coreText.healthTitle, { fontSize: 26, color: LIGHT, width: width - 80 }).node.setPosition(
            0,
            -height / 2 + 300,
        );
    }

    setProgress(ratio: number) {
        if (this.progress?.isValid)
            this.progress.string = coreText.loadingProgress
                .split('{percent}')
                .join(String(Math.round(Math.min(1, Math.max(0, ratio)) * 100)));
    }

    setText(text: string) {
        if (this.progress?.isValid) this.progress.string = text;
    }

    /** 至少展示 minMs 后关闭 */
    async hide(minMs = 0): Promise<void> {
        const wait = this.shownAt + minMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        this.modal?.close();
        this.modal = null;
        this.progress = null;
    }

    get visible(): boolean {
        return this.modal?.root.isValid === true && this.modal.root.parent !== null;
    }
}
