import type { AdProvider, InterstitialResult, RewardedResult } from '../platform/types';
import { AdPolicy, type AdPolicyOptions } from './AdPolicy';

export interface AdUnits {
    rewarded?: Record<string, string>;
    interstitial?: Record<string, string>;
}

export interface AdServiceOptions {
    policy?: AdPolicy;
    onResult?: (
        kind: 'rewarded' | 'interstitial',
        placement: string,
        result: RewardedResult | InterstitialResult,
    ) => void;
}

export class AdService {
    private provider: AdProvider | null = null;
    private units: AdUnits = {};
    private showing = false;
    readonly policy: AdPolicy;
    /** 调试用：设置后不调用平台广告，直接返回该结果 */
    simulate: RewardedResult['result'] | null = null;

    constructor(private readonly options: AdServiceOptions = {}) {
        this.policy = options.policy ?? new AdPolicy();
    }

    setProvider(provider: AdProvider) {
        this.provider = provider;
    }

    configure(config: AdUnits & { policy?: Partial<AdPolicyOptions> }) {
        this.units = {
            rewarded: { ...this.units.rewarded, ...config.rewarded },
            interstitial: { ...this.units.interstitial, ...config.interstitial },
        };
        if (config.policy) this.policy.configure(config.policy);
    }

    get isShowing(): boolean {
        return this.showing;
    }

    async showRewarded(placement: string): Promise<RewardedResult> {
        if (this.simulate) {
            const simulated: RewardedResult =
                this.simulate === 'failed' ? { result: 'failed', reason: 'unsupported' } : { result: this.simulate };
            return this.emit('rewarded', placement, simulated);
        }
        const blocked = this.precheck(this.units.rewarded, placement);
        if (blocked) return this.emit('rewarded', placement, { result: 'failed', reason: blocked });
        const result = await this.run(() => this.provider!.showRewarded(this.unitFor(this.units.rewarded, placement)));
        if (result.result !== 'failed') this.policy.recordRewardedShown();
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
        const result = await this.run(() =>
            this.provider!.showInterstitial(this.unitFor(this.units.interstitial, placement)),
        );
        if (result.result === 'shown') this.policy.recordInterstitialShown();
        else this.policy.recordInterstitialError(result.errCode);
        return this.emit('interstitial', placement, result);
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

    private async run<T extends RewardedResult | InterstitialResult>(show: () => Promise<T>): Promise<T> {
        this.showing = true;
        try {
            return await show();
        } catch {
            return { result: 'failed', reason: 'show_failed' } as T;
        } finally {
            this.showing = false;
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
