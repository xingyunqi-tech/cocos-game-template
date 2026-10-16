export interface UploadRecord {
    event: string;
    params: Record<string, unknown>;
    time: number;
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
}

/** 埋点批量上报：满 batchSize 条或到达间隔时发送；失败的记录放回队列并退避，永久错误丢弃该批；超过 maxBuffer 丢弃最旧的 */
export class TrackUploader {
    private buffer: UploadRecord[] = [];
    private timer: unknown = null;
    private sending: Promise<void> | null = null;
    private failures = 0;

    constructor(private readonly options: TrackUploaderOptions) {}

    get pending(): number {
        return this.buffer.length;
    }

    push(record: UploadRecord) {
        this.buffer.push(record);
        const max = this.options.maxBuffer ?? 500;
        if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
        if (this.buffer.length >= (this.options.batchSize ?? 20)) void this.flush();
        else this.arm();
    }

    flush(): Promise<void> {
        this.disarm();
        if (this.sending || this.buffer.length === 0) return this.sending ?? Promise.resolve();
        const batch = this.buffer.splice(0, this.options.batchSize ?? 20);
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
                },
                (err: unknown) => {
                    if (this.options.isPermanent?.(err)) {
                        this.failures = 0;
                        return;
                    }
                    this.failures++;
                    this.buffer.unshift(...batch);
                    const max = this.options.maxBuffer ?? 500;
                    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
                },
            )
            .then(() => {
                this.sending = null;
                if (this.buffer.length > 0) this.arm();
            });
        return this.sending;
    }

    /** 连续发送直到队列为空或发送失败 */
    async flushAll(): Promise<void> {
        for (;;) {
            if (this.sending) {
                await this.sending;
                continue;
            }
            if (this.buffer.length === 0) return;
            await this.flush();
            if (this.failures > 0) return;
        }
    }

    private arm() {
        if (this.timer !== null) return;
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
