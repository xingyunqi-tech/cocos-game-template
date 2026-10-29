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
    before?: string;
    after?: string;
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
    private readonly completed = new Set<string>();
    private running = false;

    /** before / after 在 run() 时解析，锚点可以晚于本步骤注册；同一锚点的多个步骤按注册顺序排列 */
    register(name: string, run: StepRun, options: StepOptions = {}): this {
        if (this.steps.some((s) => s.name === name)) throw new Error(`启动步骤重复注册：${name}`);
        if (options.before !== undefined && options.after !== undefined) {
            throw new Error(`启动步骤 ${name} 不能同时指定 before 与 after`);
        }
        this.steps.push({
            name,
            run,
            weight: Math.max(0, options.weight ?? 1),
            optional: options.optional ?? false,
            timeoutMs: options.timeoutMs,
            before: options.before,
            after: options.after,
        });
        return this;
    }

    /** 解析后的执行顺序；锚点未注册或循环依赖时抛错 */
    get stepNames(): string[] {
        return this.ordered().map((s) => s.name);
    }

    private ordered(): Step[] {
        const placed = this.steps.filter((s) => s.before === undefined && s.after === undefined);
        const lastAfter = new Map<string, Step>();
        let pending = this.steps.filter((s) => !placed.includes(s));
        while (pending.length > 0) {
            const rest: Step[] = [];
            for (const step of pending) {
                const anchor = (step.before ?? step.after)!;
                const target = placed.find((s) => s.name === anchor);
                if (!target) {
                    rest.push(step);
                    continue;
                }
                if (step.before !== undefined) {
                    placed.splice(placed.indexOf(target), 0, step);
                } else {
                    placed.splice(placed.indexOf(lastAfter.get(anchor) ?? target) + 1, 0, step);
                    lastAfter.set(anchor, step);
                }
            }
            if (rest.length === pending.length) {
                const detail = rest.map((s) => `${s.name} → ${s.before ?? s.after}`).join('，');
                throw new Error(`启动步骤的锚点未注册或循环依赖：${detail}`);
            }
            pending = rest;
        }
        return placed;
    }

    /** 清除已完成记录，下次 run() 执行全部步骤 */
    reset() {
        if (this.running) throw new Error('启动流水线正在运行');
        this.completed.clear();
    }

    /** 已成功的步骤在再次 run() 时跳过（计入进度，不产生结果），失败重试只执行未完成的步骤 */
    async run(hooks: PipelineHooks = {}): Promise<StepResult[]> {
        if (this.running) throw new Error('启动流水线正在运行');
        const steps = this.ordered();
        this.running = true;
        const now = hooks.now ?? (() => Date.now());
        const total = steps.reduce((sum, s) => sum + s.weight, 0) || 1;
        const results: StepResult[] = [];
        let done = 0;
        try {
            for (const step of steps) {
                if (this.completed.has(step.name)) {
                    done += step.weight;
                    hooks.onProgress?.(done / total, step.name);
                    continue;
                }
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
                if (result.ok) this.completed.add(step.name);
                done += step.weight;
                hooks.onProgress?.(done / total, step.name);
            }
            return results;
        } finally {
            this.running = false;
        }
    }
}
