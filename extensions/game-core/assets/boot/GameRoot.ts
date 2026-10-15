import { _decorator, Color, JsonAsset, Label, Node, resources, UITransform } from 'cc';
import { Root } from 'db://oops-framework/core/Root';
import { GuiPromptConfig } from 'db://oops-framework/core/gui/GuiPromptConfig';
import { retry } from './retry';

const { ccclass } = _decorator;

export const CONFIG_PATH = 'config';
export const CONFIG_LOAD_ATTEMPTS = 3;

const FALLBACK_TEXT = '配置加载失败，点击重试';
const LOADING_TEXT = '加载中…';

GuiPromptConfig.Notify.path = 'common/prefab/notify';
GuiPromptConfig.Wait.path = 'common/prefab/wait';
GuiPromptConfig.Mask.path = 'common/prefab/mask';

function loadConfig(): Promise<JsonAsset> {
    return new Promise((resolve, reject) => {
        resources.load(CONFIG_PATH, JsonAsset, (err, asset) => (err ? reject(err) : resolve(asset)));
    });
}

@ccclass('GameRoot')
export class GameRoot extends Root {
    private state: 'idle' | 'booting' | 'booted' = 'idle';
    private fallback: Label | null = null;

    onLoad() {
        this.enabled = false;
        void this.boot();
    }

    private async boot() {
        if (this.state !== 'idle') return;
        this.state = 'booting';
        if (this.fallback) this.fallback.string = LOADING_TEXT;
        try {
            await retry(loadConfig, CONFIG_LOAD_ATTEMPTS);
        } catch (err) {
            console.error('[game-core] config.json 加载失败', err);
            this.state = 'idle';
            this.showFallback();
            return;
        }
        this.state = 'booted';
        this.fallback?.node.destroy();
        this.fallback = null;
        super.onLoad();
    }

    private showFallback() {
        if (this.fallback) {
            this.fallback.string = FALLBACK_TEXT;
            return;
        }
        const node = new Node('ConfigLoadFailed');
        node.layer = this.gui.layer;
        node.addComponent(UITransform).setContentSize(720, 200);
        const label = node.addComponent(Label);
        label.string = FALLBACK_TEXT;
        label.fontSize = 32;
        label.color = Color.WHITE;
        node.parent = this.gui;
        node.on(Node.EventType.TOUCH_END, () => void this.boot());
        this.fallback = label;
    }
}
