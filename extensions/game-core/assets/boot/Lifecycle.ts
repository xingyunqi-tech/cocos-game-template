export type ShowListener = () => void;
export type HideListener = () => void;

export interface MessageSource {
    on(event: string, listener: (...args: unknown[]) => void, target: object): void;
    off(event: string, listener?: (...args: unknown[]) => void, target?: object): void;
}

export class Lifecycle {
    private readonly showListeners = new Set<ShowListener>();
    private readonly hideListeners = new Set<HideListener>();
    private unbind: (() => void) | null = null;

    onShow(listener: ShowListener): () => void {
        this.showListeners.add(listener);
        return () => this.showListeners.delete(listener);
    }

    onHide(listener: HideListener): () => void {
        this.hideListeners.add(listener);
        return () => this.hideListeners.delete(listener);
    }

    emitShow() {
        this.dispatch(this.showListeners);
    }

    emitHide() {
        this.dispatch(this.hideListeners);
    }

    bind(source: MessageSource, showEvent: string, hideEvent: string) {
        this.unbind?.();
        const onShow = () => this.emitShow();
        const onHide = () => this.emitHide();
        source.on(showEvent, onShow, this);
        source.on(hideEvent, onHide, this);
        this.unbind = () => {
            source.off(showEvent, onShow, this);
            source.off(hideEvent, onHide, this);
            this.unbind = null;
        };
    }

    dispose() {
        this.unbind?.();
        this.showListeners.clear();
        this.hideListeners.clear();
    }

    private dispatch(listeners: Set<() => void>) {
        for (const listener of Array.from(listeners)) {
            try {
                listener();
            } catch (err) {
                console.error('[game-core] 生命周期回调异常', err);
            }
        }
    }
}
