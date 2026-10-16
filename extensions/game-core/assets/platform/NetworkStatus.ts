import type { IPlatform, NetworkType } from './types';

/** 在线状态变化时回调 */
export type NetworkListener = (online: boolean, type: NetworkType) => void;

export class NetworkStatus {
    private currentType: NetworkType = 'unknown';
    private listeners: NetworkListener[] = [];
    private stop: (() => void) | null = null;
    private changedSinceStart = false;

    get online(): boolean {
        return this.currentType !== 'none';
    }

    get type(): NetworkType {
        return this.currentType;
    }

    async start(platform: IPlatform): Promise<void> {
        this.stop?.();
        this.changedSinceStart = false;
        this.stop = platform.onNetworkChange((online, type) => {
            this.changedSinceStart = true;
            this.update(online ? (type === 'none' ? 'unknown' : type) : 'none');
        });
        const initial = await platform.getNetworkType();
        if (!this.changedSinceStart) this.update(initial);
    }

    dispose() {
        this.stop?.();
        this.stop = null;
        this.listeners = [];
    }

    onChange(listener: NetworkListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private update(type: NetworkType) {
        const wasOnline = this.online;
        this.currentType = type;
        const online = this.online;
        if (wasOnline === online) return;
        for (const listener of this.listeners.slice()) {
            try {
                listener(online, type);
            } catch (err) {
                console.error('[game-core] 网络状态回调异常', err);
            }
        }
    }
}
