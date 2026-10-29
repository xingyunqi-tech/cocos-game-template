export type ErrorSource = 'global' | 'promise' | 'resource' | 'memory' | 'http' | 'boot' | 'manual';

export interface ErrorReport {
    source: ErrorSource;
    message: string;
    stack?: string;
    context: Record<string, unknown>;
    time: number;
}

export type ErrorSink = (report: ErrorReport) => void;

function describe(err: unknown): { message: string; stack?: string } {
    if (err instanceof Error) return { message: err.message, stack: err.stack };
    if (typeof err === 'string') return { message: err };
    try {
        return { message: JSON.stringify(err) ?? String(err) };
    } catch {
        return { message: String(err) };
    }
}

export class ErrorReporter {
    private sinks: ErrorSink[] = [];
    private common: Record<string, unknown> = {};

    setContext(context: Record<string, unknown>) {
        this.common = { ...this.common, ...context };
    }

    addSink(sink: ErrorSink): () => void {
        this.sinks.push(sink);
        return () => {
            this.sinks = this.sinks.filter((s) => s !== sink);
        };
    }

    report(err: unknown, source: ErrorSource = 'manual', context: Record<string, unknown> = {}) {
        const record: ErrorReport = {
            source,
            ...describe(err),
            context: { ...this.common, ...context },
            time: Date.now(),
        };
        for (const sink of this.sinks) {
            try {
                sink(record);
            } catch {
                continue;
            }
        }
    }
}

export interface ErrorThrottleOptions {
    /** 来源、信息与上下文都相同的错误在该时间内只转发一次 */
    dedupeMs?: number;
    /** 每分钟最多转发的条数 */
    maxPerMinute?: number;
    now?: () => number;
}

const MINUTE_MS = 60000;
const MAX_TRACKED = 200;

/** 包装上报用的 sink：合并重复错误、限制每分钟条数；被合并的次数在下一次同样的错误或 flush() 时以 context.repeated 转发，丢弃数以 context.dropped 转发 */
export class ErrorThrottle {
    private readonly recent = new Map<string, { until: number; repeated: number; report: ErrorReport }>();
    private windowStart = -Infinity;
    private windowCount = 0;
    private dropped = 0;

    constructor(
        private readonly sink: ErrorSink,
        private readonly options: ErrorThrottleOptions = {},
    ) {}

    readonly push: ErrorSink = (report) => {
        const now = (this.options.now ?? Date.now)();
        const key = `${report.source}|${report.message}|${safeJson(report.context)}`;
        const previous = this.recent.get(key);
        if (previous && now < previous.until) {
            previous.repeated++;
            return;
        }
        if (!this.take(now)) return;
        this.recent.delete(key);
        this.recent.set(key, { until: now + (this.options.dedupeMs ?? MINUTE_MS), repeated: 0, report });
        if (this.recent.size > MAX_TRACKED) this.evict(this.recent.keys().next().value!);
        this.forward(report, previous?.repeated ?? 0);
    };

    /** 转发尚未报告的合并次数与丢弃数 */
    flush() {
        for (const [key, entry] of Array.from(this.recent)) {
            if (entry.repeated === 0) continue;
            this.forward(entry.report, entry.repeated);
            this.recent.set(key, { ...entry, repeated: 0 });
        }
        if (this.dropped > 0) this.forward(null, 0);
    }

    private take(now: number): boolean {
        if (now - this.windowStart >= MINUTE_MS) {
            this.windowStart = now;
            this.windowCount = 0;
        }
        if (this.windowCount >= (this.options.maxPerMinute ?? 30)) {
            this.dropped++;
            return false;
        }
        this.windowCount++;
        return true;
    }

    private evict(key: string) {
        const entry = this.recent.get(key);
        this.recent.delete(key);
        if (entry?.repeated) this.forward(entry.report, entry.repeated);
    }

    private forward(report: ErrorReport | null, repeated: number) {
        const base: ErrorReport = report ?? {
            source: 'manual',
            message: '错误上报超过频率上限',
            context: {},
            time: (this.options.now ?? Date.now)(),
        };
        const extra: Record<string, number> = {};
        if (repeated > 0) extra.repeated = repeated;
        if (this.dropped > 0) extra.dropped = this.dropped;
        this.dropped = 0;
        try {
            this.sink({ ...base, context: { ...base.context, ...extra } });
        } catch {
            return;
        }
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '';
    }
}

export const errorReporter = new ErrorReporter();

export function reportError(err: unknown, source?: ErrorSource, context?: Record<string, unknown>) {
    errorReporter.report(err, source, context);
}

interface ErrorEventTarget {
    addEventListener(type: string, listener: (event: unknown) => void, options?: { capture?: boolean }): void;
    removeEventListener(type: string, listener: (event: unknown) => void, options?: { capture?: boolean }): void;
}

export function installWebErrorHooks(target: ErrorEventTarget, reporter = errorReporter): () => void {
    const onError = (event: unknown) => {
        const e = event as { error?: unknown; message?: string; filename?: string; lineno?: number; target?: unknown };
        const element = e.target as { tagName?: string; src?: string; href?: string } | undefined;
        if (element?.tagName && e.error === undefined && e.message === undefined) {
            reporter.report(`资源加载失败 ${element.src ?? element.href ?? element.tagName}`, 'resource');
            return;
        }
        reporter.report(e.error ?? e.message ?? event, 'global', { filename: e.filename, line: e.lineno });
    };
    const onRejection = (event: unknown) => {
        reporter.report((event as { reason?: unknown }).reason, 'promise');
    };
    target.addEventListener('error', onError, { capture: true });
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError, { capture: true });
        target.removeEventListener('unhandledrejection', onRejection);
    };
}
