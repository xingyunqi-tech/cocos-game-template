import { _decorator, Color, JsonAsset, Label, Node, resources, UITransform } from 'cc';
import { Root } from 'db://oops-framework/core/Root';
import { GuiPromptConfig } from 'db://oops-framework/core/gui/GuiPromptConfig';
import { bootPipeline, coreOptions, getDesignInset, healthNotice, initGameCore, runGameEntry } from '../core';
import { reportError } from '../monitor/errors';
import { createLogger } from '../monitor/logger';
import { track } from '../monitor/track';
import { BootStepError } from './BootPipeline';
import { retry } from './retry';

const log = createLogger('boot');

const { ccclass } = _decorator;

export const CONFIG_PATH = 'config';
export const CONFIG_LOAD_ATTEMPTS = 3;

const CONFIG_FAILED_TEXT = '配置加载失败，点击重试';
const BOOT_FAILED_TEXT = '启动失败，点击重试';
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
    private stage: 'config' | 'pipeline' | 'done' = 'config';
    private busy = false;
    private fallback: Label | null = null;

    onLoad() {
        this.enabled = false;
        void this.attempt();
    }

    protected run() {
        initGameCore();
        this.stage = 'pipeline';
        this.busy = false;
        void this.attempt();
    }

    private async attempt() {
        if (this.busy || this.stage === 'done') return;
        this.busy = true;
        if (this.fallback) this.fallback.string = LOADING_TEXT;
        if (this.stage === 'config') await this.loadConfigStage();
        else await this.pipelineStage();
    }

    private async loadConfigStage() {
        try {
            await retry(loadConfig, CONFIG_LOAD_ATTEMPTS);
        } catch (err) {
            console.error('[game-core] config.json 加载失败', err);
            this.busy = false;
            this.showFallback(CONFIG_FAILED_TEXT);
            return;
        }
        this.hideFallback();
        super.onLoad();
    }

    private async pipelineStage() {
        const started = Date.now();
        if (coreOptions.healthNotice) {
            healthNotice.show({ ageRating: coreOptions.ageRating, safeTop: () => getDesignInset().safeTop });
        }
        try {
            await bootPipeline.run({
                onProgress: (ratio, step) => {
                    healthNotice.setProgress(ratio);
                    log.debug('启动进度', step, Math.round(ratio * 100));
                },
                onStepDone: (result) => {
                    log.info(`步骤 ${result.name} ${result.ok ? '完成' : '失败'} ${result.durationMs}ms`);
                    track('boot_step', { step: result.name, ok: result.ok, ms: result.durationMs });
                    if (!result.ok) reportError(result.error, 'boot', { step: result.name, optional: result.optional });
                },
            });
        } catch (err) {
            if (!(err instanceof BootStepError)) reportError(err, 'boot');
            this.busy = false;
            healthNotice.setText('');
            this.showFallback(BOOT_FAILED_TEXT);
            return;
        }
        this.stage = 'done';
        this.busy = false;
        this.hideFallback();
        const elapsed = Date.now() - started;
        await healthNotice.hide(coreOptions.healthNoticeMinMs);
        track('boot_done', { ms: elapsed });
        await runGameEntry();
    }

    private hideFallback() {
        this.fallback?.node.destroy();
        this.fallback = null;
    }

    private showFallback(text: string) {
        if (this.fallback) {
            this.fallback.string = text;
            return;
        }
        const node = new Node('BootFailed');
        node.layer = this.gui.layer;
        node.addComponent(UITransform).setContentSize(720, 200);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 32;
        label.color = Color.WHITE;
        node.parent = this.gui;
        node.on(Node.EventType.TOUCH_END, () => void this.attempt());
        this.fallback = label;
    }
}
