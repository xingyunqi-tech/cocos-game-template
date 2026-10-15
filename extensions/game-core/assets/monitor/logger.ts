export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogRecord {
    level: LogLevel;
    tag: string;
    args: unknown[];
    time: number;
}

export type LogSink = (record: LogRecord) => void;

export const consoleSink: LogSink = ({ level, tag, args }) => {
    const prefix = `[${tag}]`;
    if (level === 'error') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    else if (level === 'info') console.info(prefix, ...args);
    else console.debug(prefix, ...args);
};

export class LogHub {
    private minLevel: LogLevel;
    private sinks: LogSink[];

    constructor(minLevel: LogLevel = 'debug', sinks: LogSink[] = [consoleSink]) {
        this.minLevel = minLevel;
        this.sinks = [...sinks];
    }

    setLevel(level: LogLevel) {
        this.minLevel = level;
    }

    getLevel(): LogLevel {
        return this.minLevel;
    }

    addSink(sink: LogSink): () => void {
        this.sinks.push(sink);
        return () => {
            this.sinks = this.sinks.filter((s) => s !== sink);
        };
    }

    write(level: LogLevel, tag: string, args: unknown[]) {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
        const record: LogRecord = { level, tag, args, time: Date.now() };
        for (const sink of this.sinks) {
            try {
                sink(record);
            } catch {
                continue;
            }
        }
    }

    create(tag: string): Logger {
        return new Logger(this, tag);
    }
}

export class Logger {
    constructor(
        private readonly hub: LogHub,
        readonly tag: string,
    ) {}

    debug(...args: unknown[]) {
        this.hub.write('debug', this.tag, args);
    }

    info(...args: unknown[]) {
        this.hub.write('info', this.tag, args);
    }

    warn(...args: unknown[]) {
        this.hub.write('warn', this.tag, args);
    }

    error(...args: unknown[]) {
        this.hub.write('error', this.tag, args);
    }
}

export const logHub = new LogHub();

export function createLogger(tag: string): Logger {
    return logHub.create(tag);
}
