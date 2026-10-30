export interface ServerTimeOptions {
    /** 本机墙钟，未校准时使用 */
    now?: () => number;
    /** 单调时钟（毫秒），不受修改系统时间影响；返回 null 表示平台不提供 */
    monotonic?: () => number | null;
    /** 计算自然日使用的时区偏移（分钟，东八区为 480） */
    timezoneOffsetMinutes?: number;
}

/** 已同步时推算时间落后 Date 头超过该值才重新校准 */
export const DATE_RESYNC_TOLERANCE_MS = 2000;

/** 以服务器时间为准的时钟：有单调时钟时校准后不受修改系统时间影响；没有时按服务器偏移修正本机时间，calibrated 为 false */
export class ServerTime {
    private base = 0;
    private hasBase = false;
    private steady = false;

    constructor(private readonly options: ServerTimeOptions = {}) {}

    /** 已用服务器时间同步过（不论是否基于单调时钟） */
    get synced(): boolean {
        return this.hasBase;
    }

    /** 已用服务器时间校准且基于单调时钟 */
    get calibrated(): boolean {
        return this.hasBase && this.steady;
    }

    /** 用服务器时间戳（毫秒）校准，requestStartedAt 为发起请求时 mark() 的读数，用于扣除一半往返耗时 */
    sync(serverMs: number, requestStartedAt?: number) {
        if (!Number.isFinite(serverMs) || serverMs <= 0) return;
        const { at, steady } = this.read();
        const latency = requestStartedAt !== undefined ? Math.max(0, at - requestStartedAt) / 2 : 0;
        this.base = serverMs + latency - at;
        this.hasBase = true;
        this.steady = steady;
    }

    /** 用 HTTP Date 头校准，精度为秒；未同步时补半秒校准，已同步时只在落后超过 DATE_RESYNC_TOLERANCE_MS 时向前校准 */
    syncFromDateHeader(value: string | undefined) {
        if (!value) return;
        const ms = Date.parse(value);
        if (Number.isNaN(ms)) return;
        if (!this.hasBase) this.sync(ms + 500);
        else if (ms - this.now() > DATE_RESYNC_TOLERANCE_MS) this.sync(ms);
    }

    /** 时钟读数，传给 sync 的 requestStartedAt */
    mark(): number {
        return this.read().at;
    }

    now(): number {
        if (!this.hasBase) return this.wall();
        const { at, steady } = this.read();
        return steady === this.steady ? at + this.base : this.wall();
    }

    /** 自然日，格式 YYYY-MM-DD */
    today(): string {
        const offsetMinutes = this.options.timezoneOffsetMinutes ?? 480;
        const date = new Date(this.now() + offsetMinutes * 60000);
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${date.getUTCFullYear()}-${month}-${day}`;
    }

    private read(): { at: number; steady: boolean } {
        const mono = this.options.monotonic?.() ?? null;
        return mono === null ? { at: this.wall(), steady: false } : { at: mono, steady: true };
    }

    private wall(): number {
        return (this.options.now ?? Date.now)();
    }
}
