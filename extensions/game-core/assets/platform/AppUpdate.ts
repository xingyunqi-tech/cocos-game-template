import type { IPlatform } from './types';

export class AppUpdate {
    private platform: IPlatform | null = null;
    private ready = false;
    private listeners: Array<() => void> = [];
    private failedListeners: Array<() => void> = [];

    get isReady(): boolean {
        return this.ready;
    }

    bind(platform: IPlatform) {
        this.platform = platform;
        platform.onUpdateReady(() => this.markReady());
        platform.onUpdateFailed(() => {
            for (const listener of this.failedListeners.slice()) {
                try {
                    listener();
                } catch (err) {
                    console.error('[game-core] 更新回调异常', err);
                }
            }
        });
    }

    /** 新版本已下载时回调；注册时已就绪则立即回调 */
    onReady(listener: () => void): () => void {
        if (this.ready) {
            listener();
            return () => undefined;
        }
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    onFailed(listener: () => void): () => void {
        this.failedListeners.push(listener);
        return () => {
            this.failedListeners = this.failedListeners.filter((l) => l !== listener);
        };
    }

    apply(): boolean {
        if (!this.ready || !this.platform) return false;
        this.platform.applyUpdate();
        return true;
    }

    private markReady() {
        if (this.ready) return;
        this.ready = true;
        const listeners = this.listeners;
        this.listeners = [];
        for (const listener of listeners) {
            try {
                listener();
            } catch (err) {
                console.error('[game-core] 更新回调异常', err);
            }
        }
    }
}
