import type { RemoteSettingsMap } from '../augment';

export type { RemoteSettingsMap };

export type RemoteFetcher<T> = () => Promise<Partial<T>>;

export type RemoteSource = 'defaults' | 'cache' | 'remote';

/** 未提供默认值且远程未下发的配置项读到 undefined */
export class RemoteConfig<T extends object> {
    private readonly defaults: Partial<T>;
    private overrides: Partial<T> = {};
    private values: T;
    private currentSource: RemoteSource = 'defaults';

    constructor(defaults: Partial<T>) {
        this.defaults = { ...defaults };
        this.values = { ...defaults } as T;
    }

    /** 补充或修改默认值，在模块顶层调用；已加载的远程值仍优先 */
    setDefaults(values: Partial<T>) {
        Object.assign(this.defaults, values);
        this.values = { ...this.defaults, ...this.overrides } as T;
    }

    get<K extends keyof T>(key: K): T[K] {
        return this.values[key];
    }

    all(): Readonly<T> {
        return this.values;
    }

    get source(): RemoteSource {
        return this.currentSource;
    }

    /** 拉取失败或超时时使用 fallback 返回的缓存，没有缓存则使用默认值 */
    async load(
        fetcher?: RemoteFetcher<T>,
        timeoutMs = 3000,
        fallback?: () => Partial<T> | null,
    ): Promise<RemoteSource> {
        this.apply({}, 'defaults');
        if (!fetcher) return this.currentSource;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const remote = await Promise.race([
                fetcher(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('远程配置超时')), timeoutMs);
                }),
            ]);
            this.apply(remote, 'remote');
        } catch {
            const cached = fallback?.();
            if (cached) this.apply(cached, 'cache');
        } finally {
            clearTimeout(timer);
        }
        return this.currentSource;
    }

    private apply(overrides: Partial<T>, source: RemoteSource) {
        this.overrides = { ...overrides };
        this.values = { ...this.defaults, ...this.overrides } as T;
        this.currentSource = source;
    }
}
