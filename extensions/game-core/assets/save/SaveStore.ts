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
const BACKUP_SCOPE = '__bak';

type Lock = 'newer' | 'unmigratable' | null;

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

function scopeFilter(prefix: string): (key: string) => boolean {
    return (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes(':');
}

function hasMigrationPath(from: number, to: number, migrations: Record<number, Migration> = {}): boolean {
    for (let version = from + 1; version <= to; version++) if (!migrations[version]) return false;
    return true;
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
        if (this.cache === null || this.cache.generation !== this.owner.generation) this.get();
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
    private readonly locks = new Map<string, Lock>();
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
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
            if (!isEnvelope(parsed)) throw new Error('存档结构无效');
        } catch (err) {
            this.locks.set(fullKey, null);
            this.backup(fullKey, raw);
            this.warn('存档解析失败，使用默认值', { key, error: errorText(err) });
            return options.defaults();
        }
        if (parsed.v > options.version) {
            this.locks.set(fullKey, 'newer');
            this.warn('存档版本高于当前代码，使用默认值且不写入', { key, from: parsed.v, to: options.version });
            return options.defaults();
        }
        const detail = { key, from: parsed.v, to: options.version };
        let data: unknown;
        try {
            data = hasMigrationPath(parsed.v, options.version, options.migrations)
                ? migrate(parsed, options.version, options.migrations)
                : null;
        } catch (err) {
            data = null;
            Object.assign(detail, { error: errorText(err) });
        }
        if (data === null) {
            this.locks.set(fullKey, 'unmigratable');
            this.warn('存档版本无法迁移，使用默认值且不写入', detail);
            return options.defaults();
        }
        if (data === undefined) {
            this.locks.set(fullKey, null);
            this.backup(fullKey, raw);
            this.warn('存档版本无法迁移，使用默认值', detail);
            return options.defaults();
        }
        this.locks.set(fullKey, null);
        const defaults = options.defaults();
        if (isPlainObject(defaults) && isPlainObject(data)) return { ...defaults, ...data };
        return data as T;
    }

    markDirty(key: string, version: number, serialize: () => Envelope) {
        this.checkScope('写入', key);
        const fullKey = this.prefix + key;
        const lock = this.lockOf(fullKey, version);
        if (lock) {
            if (!this.blockedWarned.has(fullKey)) {
                this.blockedWarned.add(fullKey);
                const message = lock === 'newer' ? '存档版本高于当前代码，不写入' : '存档版本无法迁移，不写入';
                this.warn(message, { key, to: version });
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
        const inScope = scopeFilter(this.prefix);
        for (const key of Array.from(this.dirty.keys())) if (inScope(key)) this.dirty.delete(key);
        for (const key of Array.from(this.locks.keys())) if (inScope(key)) this.forgetVersion(key);
        const index = this.readIndex();
        for (const key of index) if (inScope(key)) this.options.store.removeItem(key);
        this.writeIndex(index.filter((key) => !inScope(key)));
        this.scopeGeneration++;
    }

    /** 丢弃未写入的修改与读取缓存，之后从存储重新读取 */
    reload() {
        this.dirty.clear();
        this.locks.clear();
        this.blockedWarned.clear();
        this.scopeGeneration++;
    }

    /** 指定作用域是否有已写入或待写入的存档 */
    hasData(scope: string): boolean {
        return scope !== '' && this.prefixHasData(`${this.options.prefix ?? 'gc'}:${scope}:`);
    }

    private prefixHasData(prefix: string): boolean {
        const inScope = scopeFilter(prefix);
        if (Array.from(this.dirty.keys()).some(inScope) || this.readIndex().some(inScope)) return true;
        return Array.from(this.registered).some((key) => {
            const value = this.options.store.getItem(prefix + key);
            return value !== null && value !== undefined && value !== '';
        });
    }

    /** 当前作用域没有存档时，把 from 作用域的存档移入当前作用域；返回是否移入 */
    adoptScope(from: string): boolean {
        if (from.includes(':')) throw new Error(`存档作用域不能包含冒号：${from}`);
        if (!this.hasScope || !from) return false;
        this.flush();
        const source = `${this.options.prefix ?? 'gc'}:${from}:`;
        const target = this.prefix;
        if (source === target) return false;
        if (this.prefixHasData(target)) return false;
        const moving = this.readIndex().filter(scopeFilter(source));
        const moved: string[] = [];
        for (const key of moving) {
            const value = this.options.store.getItem(key);
            if (value === null || value === undefined || value === '') continue;
            const next = target + key.slice(source.length);
            try {
                this.options.store.setItem(next, value);
                moved.push(next);
            } catch (err) {
                this.warn('存档迁移写入失败', { key: next, error: errorText(err) });
                for (const written of moved) this.options.store.removeItem(written);
                return false;
            }
        }
        if (moved.length === 0) return false;
        this.addToIndex(moved);
        for (const key of moving) {
            this.options.store.removeItem(key);
            this.forgetVersion(key);
        }
        this.writeIndex(this.readIndex().filter((key) => !scopeFilter(source)(key)));
        for (const key of moved) this.forgetVersion(key);
        this.scopeGeneration++;
        return true;
    }

    private lockOf(fullKey: string, version: number): Lock {
        let lock = this.locks.get(fullKey);
        if (lock === undefined) {
            lock = (this.storedVersion(fullKey) ?? 0) > version ? 'newer' : null;
            this.locks.set(fullKey, lock);
        }
        return lock;
    }

    /** 损坏的存档原文保存到 `<prefix>:__bak:<作用域>:<key>`，每个 key 只保留最近一份 */
    private backup(fullKey: string, raw: string) {
        const root = this.options.prefix ?? 'gc';
        const backupKey = `${root}:${BACKUP_SCOPE}:${fullKey.slice(root.length + 1)}`;
        try {
            this.options.store.setItem(backupKey, raw);
        } catch (err) {
            this.warn('存档备份失败', { key: backupKey, error: errorText(err) });
        }
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
        this.locks.delete(fullKey);
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
