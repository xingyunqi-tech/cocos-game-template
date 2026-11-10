import { HttpError } from '../net/types';

const RETRYABLE_CLIENT_STATUS: readonly number[] = [401, 408, 429];

/** 上报失败是否丢弃该批：非 HTTP 错误、服务端已响应的解析或业务错误、除 401、408、429 外的 4xx 丢弃，其余退避重试 */
export function isPermanentUploadError(err: unknown): boolean {
    if (!(err instanceof HttpError)) return true;
    if (err.kind === 'parse' || err.kind === 'business') return true;
    const status = err.status ?? 0;
    return err.kind === 'http' && status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUS.includes(status);
}

export interface UploadRecord {
    event: string;
    params: Record<string, unknown>;
    time: number;
}

export interface TrackPersistence {
    load(): UploadRecord[];
    /** records 为空时清除保存的记录 */
    save(records: UploadRecord[]): void;
}

export const TRACK_MAX_AGE_MS = 3 * 24 * 3600 * 1000;

function isUploadRecord(value: unknown): value is UploadRecord {
    const record = value as Partial<UploadRecord> | null;
    return (
        typeof record === 'object' &&
        record !== null &&
        typeof record.event === 'string' &&
        typeof record.time === 'number' &&
        typeof record.params === 'object' &&
        record.params !== null
    );
}

export interface TrackUploaderOptions {
    send: (records: UploadRecord[]) => Promise<void>;
    batchSize?: number;
    intervalMs?: number;
    maxBuffer?: number;
    /** 返回 true 时丢弃该批，不再重试 */
    isPermanent?: (err: unknown) => boolean;
    maxBackoffMs?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
    cancelSchedule?: (handle: unknown) => void;
    /** 构造时读取上次保存的记录排在队列前面，persist 时保存队列与发送中的记录 */
    persist?: TrackPersistence;
    /** 读取保存的记录时丢弃早于该时长的 */
    maxAgeMs?: number;
    now?: () => number;
}

/** 埋点批量上报：满 batchSize 条或到达间隔时发送；失败的记录放回队列并退避（退避期间不因满批提前发送），永久错误丢弃该批；超过 maxBuffer 丢弃最旧的 */
export class TrackUploader {
    private buffer: UploadRecord[] = [];
    private timer: unknown = null;
    private sending: Promise<void> | null = null;
    private failures = 0;
    private inflight: UploadRecord[] = [];
    private persisted = false;

    constructor(private readonly options: TrackUploaderOptions) {
        const restored = this.restore();
        if (restored.length === 0) return;
        this.buffer = restored.slice(-(options.maxBuffer ?? 500));
        this.persisted = true;
        this.arm();
    }

    get pending(): number {
        return this.buffer.length;
    }

    push(record: UploadRecord) {
        this.buffer.push(record);
        const max = this.options.maxBuffer ?? 500;
        if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
        if (this.failures === 0 && this.buffer.length >= (this.options.batchSize ?? 20)) void this.flush();
        else this.arm();
    }

    flush(): Promise<void> {
        this.disarm();
        if (this.sending || this.buffer.length === 0) return this.sending ?? Promise.resolve();
        const batch = this.buffer.splice(0, this.options.batchSize ?? 20);
        this.inflight = batch;
        let sent: Promise<void>;
        try {
            sent = this.options.send(batch);
        } catch (err) {
            sent = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
        this.sending = sent
            .then(
                () => {
                    this.failures = 0;
                    return true;
                },
                (err: unknown) => {
                    if (this.options.isPermanent?.(err)) {
                        this.failures = 0;
                        return true;
                    }
                    this.failures++;
                    this.buffer.unshift(...batch);
                    const max = this.options.maxBuffer ?? 500;
                    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
                    return false;
                },
            )
            .then((removed) => {
                this.sending = null;
                this.inflight = [];
                if (removed && this.persisted) this.persist();
                if (this.buffer.length > 0) this.arm();
            });
        return this.sending;
    }

    /** 保存发送中与排队的记录；保存过之后每批发送成功或丢弃时同步保存一次，直到队列清空 */
    persist() {
        const persistence = this.options.persist;
        if (!persistence) return;
        const records = [...this.inflight, ...this.buffer];
        this.persisted = records.length > 0;
        try {
            persistence.save(records);
        } catch (err) {
            console.error('[game-core] 保存埋点队列失败', err);
        }
    }

    private restore(): UploadRecord[] {
        const persistence = this.options.persist;
        if (!persistence) return [];
        try {
            const records = persistence.load();
            if (!Array.isArray(records)) return [];
            const now = (this.options.now ?? Date.now)();
            const maxAge = this.options.maxAgeMs ?? TRACK_MAX_AGE_MS;
            return records.filter((record) => isUploadRecord(record) && now - record.time <= maxAge);
        } catch (err) {
            console.error('[game-core] 读取埋点队列失败', err);
            return [];
        }
    }

    /** 连续发送直到队列为空或发送失败 */
    async flushAll(): Promise<void> {
        for (;;) {
            if (this.sending) {
                await this.sending;
                if (this.failures > 0) return;
                continue;
            }
            if (this.buffer.length === 0) return;
            await this.flush();
            if (this.failures > 0) return;
        }
    }

    private arm() {
        if (this.timer !== null || this.sending) return;
        const schedule = this.options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
        this.timer = schedule(() => {
            this.timer = null;
            void this.flush();
        }, this.delay());
    }

    private delay(): number {
        const base = this.options.intervalMs ?? 10000;
        if (this.failures === 0) return base;
        return Math.min(base * 2 ** this.failures, this.options.maxBackoffMs ?? 300000);
    }

    private disarm() {
        if (this.timer === null) return;
        (this.options.cancelSchedule ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
        this.timer = null;
    }
}
