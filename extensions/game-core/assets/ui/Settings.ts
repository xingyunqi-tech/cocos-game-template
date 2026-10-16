export interface AudioSwitches {
    getMusic(): boolean;
    setMusic(on: boolean): void;
    getEffect(): boolean;
    setEffect(on: boolean): void;
}

export interface VibrationStore {
    get(): { vibrate: boolean };
    set(value: { vibrate: boolean }): void;
}

export class Settings {
    private listeners: Array<() => void> = [];

    constructor(
        private readonly audio: () => AudioSwitches | null,
        private readonly store: VibrationStore,
        private readonly vibrateImpl: (type: 'short' | 'long') => void,
    ) {}

    get music(): boolean {
        return this.audio()?.getMusic() ?? true;
    }

    set music(on: boolean) {
        this.audio()?.setMusic(on);
        this.emit();
    }

    get effect(): boolean {
        return this.audio()?.getEffect() ?? true;
    }

    set effect(on: boolean) {
        this.audio()?.setEffect(on);
        this.emit();
    }

    get vibration(): boolean {
        return this.store.get().vibrate;
    }

    set vibration(on: boolean) {
        this.store.set({ vibrate: on });
        this.emit();
    }

    /** 震动开关关闭时不调用平台接口 */
    vibrate(type: 'short' | 'long' = 'short') {
        if (this.vibration) this.vibrateImpl(type);
    }

    onChange(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private emit() {
        for (const listener of this.listeners.slice()) {
            try {
                listener();
            } catch (err) {
                console.error('[game-core] 设置回调异常', err);
            }
        }
    }
}
