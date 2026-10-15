export type ErrorSource = 'global' | 'promise' | 'resource' | 'http' | 'boot' | 'manual';

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
        return { message: JSON.stringify(err) };
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
