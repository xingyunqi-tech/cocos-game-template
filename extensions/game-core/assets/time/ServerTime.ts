export interface ServerTimeOptions {
    /** 本机墙钟，未校准时使用 */
    now?: () => number;
    /** 单调时钟（毫秒），不受修改系统时间影响 */
    monotonic?: () => number;
    /** 计算自然日使用的时区偏移（分钟，东八区为 480） */
    timezoneOffsetMinutes?: number;
}

const defaultMonotonic = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 以服务器时间为准的时钟：校准后按单调时钟推算，修改系统时间不影响；未校准时回退本机时间 */
export class ServerTime {
    private base = 0;
    private synced = false;

    constructor(private readonly options: ServerTimeOptions = {}) {}

    get calibrated(): boolean {
        return this.synced;
    }

    /** 用服务器时间戳（毫秒）校准，requestStartedAt 为发起请求时的单调时钟读数，用于扣除一半往返耗时 */
    sync(serverMs: number, requestStartedAt?: number) {
        if (!Number.isFinite(serverMs) || serverMs <= 0) return;
        const mono = this.mono();
        const latency = requestStartedAt !== undefined ? Math.max(0, mono - requestStartedAt) / 2 : 0;
        this.base = serverMs + latency - mono;
        this.synced = true;
    }

    /** 用 HTTP Date 头校准，精度为秒，补半秒 */
    syncFromDateHeader(value: string | undefined) {
        if (!value) return;
        const ms = Date.parse(value);
        if (!Number.isNaN(ms)) this.sync(ms + 500);
    }

    /** 单调时钟读数，传给 sync 的 requestStartedAt */
    mark(): number {
        return this.mono();
    }

    now(): number {
        return this.synced ? this.mono() + this.base : (this.options.now ?? Date.now)();
    }

    /** 自然日，格式 YYYY-MM-DD */
    today(): string {
        const offsetMinutes = this.options.timezoneOffsetMinutes ?? 480;
        const date = new Date(this.now() + offsetMinutes * 60000);
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${date.getUTCFullYear()}-${month}-${day}`;
    }

    private mono(): number {
        return (this.options.monotonic ?? defaultMonotonic)();
    }
}
