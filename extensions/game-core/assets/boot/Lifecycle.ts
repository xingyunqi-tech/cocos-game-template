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

export interface UserState {
    /** 存档使用的 userId，离线进入时为回退身份 */
    userId: string;
    offline: boolean;
}

export type UserReadyListener = (state: Readonly<UserState>) => void;

/** 用户就绪：登录步骤完成或离线进入后重新联网时回调；注册时已就绪则立即回调 */
export class UserReady {
    private state: UserState | null = null;
    private listeners: UserReadyListener[] = [];

    constructor(private readonly onError: (err: unknown) => void = (err) => console.error(err)) {}

    get current(): Readonly<UserState> | null {
        return this.state;
    }

    on(listener: UserReadyListener): () => void {
        this.listeners.push(listener);
        if (this.state) this.call(listener, this.state);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    emit(state: UserState) {
        this.state = { ...state };
        const current = this.state;
        for (const listener of this.listeners.slice()) this.call(listener, current);
    }

    private call(listener: UserReadyListener, state: Readonly<UserState>) {
        try {
            listener(state);
        } catch (err) {
            this.onError(err);
        }
    }
}
