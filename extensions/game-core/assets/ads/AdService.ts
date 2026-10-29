import type { AdProvider, InterstitialResult, RewardedResult } from '../platform/types';
import { AdPolicy, type AdPolicyOptions } from './AdPolicy';

export interface AdUnits {
    rewarded?: Record<string, string>;
    interstitial?: Record<string, string>;
}

export const AD_SHOW_TIMEOUT_MS = 180000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface AdServiceOptions {
    policy?: AdPolicy;
    /** 平台广告开始展示（true）与结束（false）时回调，模拟结果不触发 */
    onShowingChange?: (showing: boolean) => void;
    onResult?: (
        kind: 'rewarded' | 'interstitial',
        placement: string,
        result: RewardedResult | InterstitialResult,
    ) => void;
}

export type AdKind = 'rewarded' | 'interstitial';
export type LateAdListener = (kind: AdKind, placement: string, result: RewardedResult | InterstitialResult) => void;

export class AdService {
    private provider: AdProvider | null = null;
    private readonly lateListeners: LateAdListener[] = [];
    private units: AdUnits = {};
    private showing = false;
    private showTimeoutMs = AD_SHOW_TIMEOUT_MS;
    readonly policy: AdPolicy;
    /** 调试用：设置后不调用平台广告，直接返回该结果 */
    simulate: RewardedResult['result'] | null = null;

    constructor(private readonly options: AdServiceOptions = {}) {
        this.policy = options.policy ?? new AdPolicy();
    }

    setProvider(provider: AdProvider) {
        this.provider = provider;
    }

    /** showTimeoutMs：平台在该时间内没有返回展示结果时按 timeout 失败处理，0 或 Infinity 不限时 */
    configure(config: AdUnits & { policy?: Partial<AdPolicyOptions>; showTimeoutMs?: number }) {
        this.units = {
            rewarded: { ...this.units.rewarded, ...config.rewarded },
            interstitial: { ...this.units.interstitial, ...config.interstitial },
        };
        if (config.policy) this.policy.configure(config.policy);
        if (config.showTimeoutMs !== undefined) this.showTimeoutMs = config.showTimeoutMs;
    }

    get isShowing(): boolean {
        return this.showing;
    }

    /** 展示超时返回 timeout 之后平台给出的结果；激励视频为 completed 时由业务决定是否补发奖励 */
    onLateResult(listener: LateAdListener): () => void {
        this.lateListeners.push(listener);
        return () => {
            const index = this.lateListeners.indexOf(listener);
            if (index >= 0) this.lateListeners.splice(index, 1);
        };
    }

    async showRewarded(placement: string): Promise<RewardedResult> {
        if (this.simulate) {
            const simulated: RewardedResult =
                this.simulate === 'failed' ? { result: 'failed', reason: 'unsupported' } : { result: this.simulate };
            return this.emit('rewarded', placement, simulated);
        }
        const blocked = this.precheck(this.units.rewarded, placement);
        if (blocked) return this.emit('rewarded', placement, { result: 'failed', reason: blocked });
        const result = await this.run(
            () => this.provider!.showRewarded(this.unitFor(this.units.rewarded, placement)),
            (late) => {
                if (late.result !== 'failed') this.policy.recordRewardedShown();
                this.emitLate('rewarded', placement, late);
            },
        );
        if (result.result !== 'failed' || result.reason === 'timeout') this.policy.recordRewardedShown();
        return this.emit('rewarded', placement, result);
    }

    async showInterstitial(placement: string): Promise<InterstitialResult> {
        if (this.simulate) {
            const simulated: InterstitialResult =
                this.simulate === 'failed' ? { result: 'failed', reason: 'unsupported' } : { result: 'shown' };
            return this.emit('interstitial', placement, simulated);
        }
        const blocked = this.precheck(this.units.interstitial, placement);
        if (blocked) return this.emit('interstitial', placement, { result: 'failed', reason: blocked });
        if (this.policy.interstitialWaitMs() > 0) {
            return this.emit('interstitial', placement, { result: 'failed', reason: 'frequency' });
        }
        const result = await this.run(
            () => this.provider!.showInterstitial(this.unitFor(this.units.interstitial, placement)),
            (late) => {
                if (late.result === 'shown') this.policy.recordInterstitialShown();
                this.emitLate('interstitial', placement, late);
            },
        );
        if (result.result === 'shown' || result.reason === 'timeout') this.policy.recordInterstitialShown();
        else this.policy.recordInterstitialError(result.errCode);
        return this.emit('interstitial', placement, result);
    }

    /** 提前加载该广告位的激励视频；未配置广告单元或平台不支持时忽略 */
    preloadRewarded(placement: string) {
        const provider = this.provider;
        if (!provider?.preloadRewarded) return;
        if (provider.needsUnitId && !this.units.rewarded?.[placement]) return;
        provider.preloadRewarded(this.unitFor(this.units.rewarded, placement));
    }

    private precheck(units: Record<string, string> | undefined, placement: string) {
        if (!this.provider) return 'unsupported' as const;
        if (this.showing) return 'busy' as const;
        if (this.provider.needsUnitId && !units?.[placement]) return 'not_configured' as const;
        return null;
    }

    private unitFor(units: Record<string, string> | undefined, placement: string): string {
        return units?.[placement] ?? placement;
    }

    private async run<T extends RewardedResult | InterstitialResult>(
        show: () => Promise<T>,
        onLate: (result: T) => void,
    ): Promise<T> {
        this.showing = true;
        this.notifyShowing(true);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let shown: Promise<T> | null = null;
        let timedOut = false;
        const limit = this.showTimeoutMs;
        try {
            shown = show();
            const pending = [shown];
            if (limit > 0 && limit <= MAX_TIMER_MS) {
                pending.push(
                    new Promise<T>((resolve) => {
                        timer = setTimeout(() => {
                            timedOut = true;
                            resolve({ result: 'failed', reason: 'timeout' } as T);
                        }, limit);
                    }),
                );
            }
            return await Promise.race(pending);
        } catch {
            return { result: 'failed', reason: 'show_failed' } as T;
        } finally {
            clearTimeout(timer);
            this.showing = false;
            this.notifyShowing(false);
            if (timedOut && shown) {
                shown
                    .then(onLate, () => onLate({ result: 'failed', reason: 'show_failed' } as T))
                    .catch((err) => console.error('[game-core] 广告结果回调异常', err));
            }
        }
    }

    private emitLate(kind: AdKind, placement: string, result: RewardedResult | InterstitialResult) {
        for (const listener of this.lateListeners.slice()) {
            try {
                listener(kind, placement, result);
            } catch (err) {
                console.error('[game-core] 广告结果回调异常', err);
            }
        }
    }

    private notifyShowing(showing: boolean) {
        try {
            this.options.onShowingChange?.(showing);
        } catch (err) {
            console.error('[game-core] 广告展示回调异常', err);
        }
    }

    private emit<T extends RewardedResult | InterstitialResult>(
        kind: 'rewarded' | 'interstitial',
        placement: string,
        result: T,
    ): T {
        try {
            this.options.onResult?.(kind, placement, result);
        } catch (err) {
            console.error('[game-core] 广告结果回调异常', err);
        }
        return result;
    }
}
