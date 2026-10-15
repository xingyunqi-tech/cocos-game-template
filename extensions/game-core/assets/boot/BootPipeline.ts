import { CancelSource, type CancelSignal } from '../net/types';

export interface StepContext {
    progress(ratio: number): void;
    readonly signal: CancelSignal;
}

export interface StepOptions {
    weight?: number;
    optional?: boolean;
    timeoutMs?: number;
    before?: string;
    after?: string;
}

export type StepRun = (context: StepContext) => void | Promise<void>;

export interface StepResult {
    name: string;
    ok: boolean;
    optional: boolean;
    durationMs: number;
    error?: unknown;
}

export class BootStepError extends Error {
    constructor(
        readonly step: string,
        readonly cause: unknown,
    ) {
        super(`启动步骤 ${step} 失败`);
        this.name = 'BootStepError';
    }
}

interface Step {
    name: string;
    run: StepRun;
    weight: number;
    optional: boolean;
    timeoutMs?: number;
}

export interface PipelineHooks {
    onProgress?: (ratio: number, step: string) => void;
    onStepDone?: (result: StepResult) => void;
    now?: () => number;
}

function withTimeout(task: Promise<void>, ms: number | undefined, name: string): Promise<void> {
    if (!ms) return task;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`启动步骤 ${name} 超时 ${ms}ms`)), ms);
        task.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

export class BootPipeline {
    private readonly steps: Step[] = [];
    private running = false;

    register(name: string, run: StepRun, options: StepOptions = {}): this {
        if (this.steps.some((s) => s.name === name)) throw new Error(`启动步骤重复注册：${name}`);
        const step: Step = {
            name,
            run,
            weight: Math.max(0, options.weight ?? 1),
            optional: options.optional ?? false,
            timeoutMs: options.timeoutMs,
        };
        const anchor = options.before ?? options.after;
        if (anchor === undefined) {
            this.steps.push(step);
            return this;
        }
        const index = this.steps.findIndex((s) => s.name === anchor);
        if (index < 0) throw new Error(`启动步骤 ${name} 的锚点 ${anchor} 未注册`);
        this.steps.splice(options.before !== undefined ? index : index + 1, 0, step);
        return this;
    }

    get stepNames(): string[] {
        return this.steps.map((s) => s.name);
    }

    async run(hooks: PipelineHooks = {}): Promise<StepResult[]> {
        if (this.running) throw new Error('启动流水线正在运行');
        this.running = true;
        const now = hooks.now ?? (() => Date.now());
        const total = this.steps.reduce((sum, s) => sum + s.weight, 0) || 1;
        const results: StepResult[] = [];
        let done = 0;
        try {
            for (const step of this.steps.slice()) {
                const base = done;
                const cancel = new CancelSource();
                const report = (ratio: number) => {
                    if (cancel.signal.cancelled) return;
                    const clamped = Math.min(1, Math.max(0, ratio));
                    hooks.onProgress?.((base + step.weight * clamped) / total, step.name);
                };
                report(0);
                const started = now();
                let error: unknown;
                try {
                    await withTimeout(
                        Promise.resolve().then(() => step.run({ progress: report, signal: cancel.signal })),
                        step.timeoutMs,
                        step.name,
                    );
                } catch (err) {
                    error = err;
                }
                cancel.cancel();
                const result: StepResult = {
                    name: step.name,
                    ok: error === undefined,
                    optional: step.optional,
                    durationMs: now() - started,
                    error,
                };
                results.push(result);
                hooks.onStepDone?.(result);
                if (!result.ok && !step.optional) throw new BootStepError(step.name, error);
                done += step.weight;
                hooks.onProgress?.(done / total, step.name);
            }
            return results;
        } finally {
            this.running = false;
        }
    }
}
