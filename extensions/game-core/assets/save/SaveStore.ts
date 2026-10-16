import type { KeyValueStore } from './KeyValueStore';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

export interface SlotOptions<T> {
    version: number;
    defaults: () => T;
    migrations?: Record<number, Migration>;
}

interface Envelope {
    v: number;
    d: unknown;
}

export interface SaveStoreOptions {
    store: KeyValueStore;
    prefix?: string;
    requireScope?: boolean;
    throttleMs?: number;
    warnBytes?: number;
    onWarn?: (message: string, detail: Record<string, unknown>) => void;
    schedule?: (fn: () => void, ms: number) => unknown;
    cancelSchedule?: (handle: unknown) => void;
}

const INDEX_KEY = '__index';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is Envelope {
    return isPlainObject(value) && typeof value.v === 'number' && Number.isInteger(value.v);
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function utf8Bytes(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            i++;
        } else bytes += 3;
    }
    return bytes;
}

export function migrate(raw: Envelope, target: number, migrations: Record<number, Migration> = {}): unknown {
    let version = raw.v;
    let data = raw.d;
    if (version > target) return undefined;
    while (version < target) {
        const step = migrations[version + 1];
        if (!step || !isPlainObject(data)) return undefined;
        data = step(data);
        version++;
    }
    return data;
}

export class SaveSlot<T> {
    private cache: { generation: number; value: T } | null = null;

    constructor(
        private readonly owner: SaveStore,
        readonly key: string,
        private readonly options: SlotOptions<T>,
    ) {}

    get(): T {
        if (this.cache === null || this.cache.generation !== this.owner.generation) {
            this.cache = { generation: this.owner.generation, value: this.owner.read(this.key, this.options) };
        }
        return this.cache.value;
    }

    set(value: T) {
        this.cache = { generation: this.owner.generation, value };
        const version = this.options.version;
        this.owner.markDirty(this.key, version, () => ({ v: version, d: value }));
    }

    update(mutate: (draft: T) => void) {
        const value = this.get();
        mutate(value);
        this.set(value);
    }

    reset() {
        this.cache = null;
        this.owner.remove(this.key);
    }
}

export class SaveStore {
    private scope = '';
    private readonly dirty = new Map<string, () => Envelope>();
    private timer: unknown = null;
    private scopeGeneration = 0;
    private readonly registered = new Set<string>();
    private readonly newer = new Map<string, boolean>();
    private readonly blockedWarned = new Set<string>();

    constructor(private readonly options: SaveStoreOptions) {}

    get generation(): number {
        return this.scopeGeneration;
    }

    get prefix(): string {
        return `${this.options.prefix ?? 'gc'}:${this.scope}`;
    }

    get hasScope(): boolean {
        return this.scope !== '';
    }

    setScope(scope: string) {
        if (scope.includes(':')) throw new Error(`存档作用域不能包含冒号：${scope}`);
        this.flush();
        this.scope = scope ? `${scope}:` : '';
        this.scopeGeneration++;
    }

    slot<T>(key: string, options: SlotOptions<T>): SaveSlot<T> {
        if (key.includes(':')) throw new Error(`存档 key 不能包含冒号：${key}`);
        if (this.registered.has(key)) throw new Error(`存档 key 重复注册：${key}`);
        this.registered.add(key);
        return new SaveSlot(this, key, options);
    }

    read<T>(key: string, options: SlotOptions<T>): T {
        this.checkScope('读取', key);
        const fullKey = this.prefix + key;
        const raw = this.options.store.getItem(fullKey);
        if (raw === null || raw === undefined || raw === '') return options.defaults();
        let data: unknown;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (!isEnvelope(parsed)) throw new Error('存档结构无效');
            const newer = parsed.v > options.version;
            this.newer.set(fullKey, newer);
            if (newer) {
                this.warn('存档版本高于当前代码，使用默认值且不写入', { key, from: parsed.v, to: options.version });
                return options.defaults();
            }
            data = migrate(parsed, options.version, options.migrations);
            if (data === undefined) {
                this.warn('存档版本无法迁移，使用默认值', { key, from: parsed.v, to: options.version });
                return options.defaults();
            }
        } catch (err) {
            this.warn('存档解析失败，使用默认值', { key, error: errorText(err) });
            return options.defaults();
        }
        const defaults = options.defaults();
        if (isPlainObject(defaults) && isPlainObject(data)) return { ...defaults, ...data };
        return data as T;
    }

    markDirty(key: string, version: number, serialize: () => Envelope) {
        this.checkScope('写入', key);
        const fullKey = this.prefix + key;
        if (this.isNewer(fullKey, version)) {
            if (!this.blockedWarned.has(fullKey)) {
                this.blockedWarned.add(fullKey);
                this.warn('存档版本高于当前代码，不写入', { key, to: version });
            }
            return;
        }
        this.dirty.set(fullKey, serialize);
        if (this.timer !== null) return;
        const schedule = this.options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
        this.timer = schedule(() => {
            this.timer = null;
            this.flush();
        }, this.options.throttleMs ?? 1000);
    }

    flush(): boolean {
        if (this.timer !== null) {
            (this.options.cancelSchedule ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
            this.timer = null;
        }
        let ok = true;
        const written: string[] = [];
        for (const [fullKey, serialize] of Array.from(this.dirty)) {
            try {
                const text = JSON.stringify(serialize());
                const bytes = utf8Bytes(text);
                const limit = this.options.warnBytes ?? 512 * 1024;
                if (bytes > limit) this.warn('存档体积超过阈值', { key: fullKey, bytes, limit });
                this.options.store.setItem(fullKey, text);
                this.dirty.delete(fullKey);
                written.push(fullKey);
            } catch (err) {
                ok = false;
                this.warn('存档写入失败', { key: fullKey, error: errorText(err) });
            }
        }
        if (written.length > 0) this.addToIndex(written);
        return ok;
    }

    remove(key: string) {
        const fullKey = this.prefix + key;
        this.dirty.delete(fullKey);
        this.forgetVersion(fullKey);
        this.options.store.removeItem(fullKey);
        this.removeFromIndex(fullKey);
    }

    clearScope() {
        const prefix = this.prefix;
        const inScope = (key: string) => key.startsWith(prefix) && !key.slice(prefix.length).includes(':');
        for (const key of Array.from(this.dirty.keys())) if (inScope(key)) this.dirty.delete(key);
        for (const key of Array.from(this.newer.keys())) if (inScope(key)) this.forgetVersion(key);
        const index = this.readIndex();
        for (const key of index) if (inScope(key)) this.options.store.removeItem(key);
        this.writeIndex(index.filter((key) => !inScope(key)));
        this.scopeGeneration++;
    }

    private isNewer(fullKey: string, version: number): boolean {
        let newer = this.newer.get(fullKey);
        if (newer === undefined) {
            newer = (this.storedVersion(fullKey) ?? 0) > version;
            this.newer.set(fullKey, newer);
        }
        return newer;
    }

    private storedVersion(fullKey: string): number | null {
        const raw = this.options.store.getItem(fullKey);
        if (!raw) return null;
        try {
            const parsed: unknown = JSON.parse(raw);
            return isEnvelope(parsed) ? parsed.v : null;
        } catch {
            return null;
        }
    }

    private forgetVersion(fullKey: string) {
        this.newer.delete(fullKey);
        this.blockedWarned.delete(fullKey);
    }

    private checkScope(action: string, key: string) {
        if (this.options.requireScope && !this.hasScope) this.warn(`未设置存档作用域时${action}`, { key });
    }

    private indexKey(): string {
        return `${this.options.prefix ?? 'gc'}:${INDEX_KEY}`;
    }

    private readIndex(): string[] {
        try {
            const value: unknown = JSON.parse(this.options.store.getItem(this.indexKey()) || '[]');
            return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
        } catch {
            return [];
        }
    }

    private writeIndex(keys: string[]) {
        try {
            this.options.store.setItem(this.indexKey(), JSON.stringify(keys));
        } catch (err) {
            this.warn('存档索引写入失败', { error: errorText(err) });
        }
    }

    private addToIndex(keys: string[]) {
        const index = this.readIndex();
        const missing = keys.filter((key) => !index.includes(key));
        if (missing.length > 0) this.writeIndex(index.concat(missing));
    }

    private removeFromIndex(key: string) {
        const index = this.readIndex();
        if (index.includes(key)) this.writeIndex(index.filter((k) => k !== key));
    }

    private warn(message: string, detail: Record<string, unknown>) {
        this.options.onWarn?.(message, detail);
    }
}
