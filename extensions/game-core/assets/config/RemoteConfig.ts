import type { RemoteSettingsMap } from '../augment';

export type { RemoteSettingsMap };

export type RemoteFetcher<T> = () => Promise<Partial<T>>;

export type RemoteSource = 'defaults' | 'cache' | 'remote';

export type InvalidRemoteValue = (key: string, value: unknown) => void;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameShape(base: unknown, value: unknown): boolean {
    if (base === undefined || base === null) return true;
    if (isPlainObject(base)) return isPlainObject(value);
    if (Array.isArray(base)) {
        return Array.isArray(value) && (base.length === 0 || value.every((item) => sameShape(base[0], item)));
    }
    return typeof value === typeof base;
}

function mergeValue(base: unknown, value: unknown, key: string, onInvalid?: InvalidRemoteValue): unknown {
    if (base === undefined || base === null) return value;
    if (!sameShape(base, value)) {
        onInvalid?.(key, value);
        return base;
    }
    return isPlainObject(base) ? mergeObject(base, value as Record<string, unknown>, `${key}.`, onInvalid) : value;
}

function mergeObject(
    base: Record<string, unknown>,
    overrides: Record<string, unknown>,
    path: string,
    onInvalid?: InvalidRemoteValue,
): Record<string, unknown> {
    const merged = { ...base };
    for (const key of Object.keys(overrides)) {
        const value = overrides[key];
        if (value === undefined || key === '__proto__') continue;
        const own = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined;
        merged[key] = mergeValue(own, value, path + key, onInvalid);
    }
    return merged;
}

/** 远程值按默认值深合并，类型与默认值不一致的项忽略；未提供默认值且远程未下发的配置项读到 undefined */
export class RemoteConfig<T extends object> {
    private readonly defaults: Partial<T>;
    private overrides: Partial<T> = {};
    private values: T;
    private currentSource: RemoteSource = 'defaults';

    /** onInvalid：加载的远程值或缓存中类型与默认值不一致的项 */
    constructor(
        defaults: Partial<T>,
        private readonly onInvalid?: InvalidRemoteValue,
    ) {
        this.defaults = { ...defaults };
        this.values = { ...defaults } as T;
    }

    /** 补充或修改默认值，在模块顶层调用；已加载的远程值仍优先 */
    setDefaults(values: Partial<T>) {
        Object.assign(this.defaults, values);
        this.values = this.merge();
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

    /** 拉取失败或超时时使用 fallback 返回的缓存，没有缓存时保留当前值；不传 fetcher 时恢复默认值 */
    async load(
        fetcher?: RemoteFetcher<T>,
        timeoutMs = 3000,
        fallback?: () => Partial<T> | null,
    ): Promise<RemoteSource> {
        if (!fetcher) {
            this.apply({}, 'defaults');
            return this.currentSource;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const remote = await Promise.race([
                fetcher(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('远程配置超时')), timeoutMs);
                }),
            ]);
            if (!isPlainObject(remote)) throw new Error('远程配置不是对象');
            this.apply(remote, 'remote');
        } catch {
            const cached = fallback?.();
            if (isPlainObject(cached)) this.apply(cached, 'cache');
        } finally {
            clearTimeout(timer);
        }
        return this.currentSource;
    }

    private apply(overrides: Partial<T>, source: RemoteSource) {
        this.overrides = { ...overrides };
        this.values = this.merge(this.onInvalid);
        this.currentSource = source;
    }

    private merge(onInvalid?: InvalidRemoteValue): T {
        return mergeObject(this.defaults, this.overrides, '', onInvalid) as T;
    }
}
