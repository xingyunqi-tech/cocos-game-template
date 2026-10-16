export interface AdPolicyOptions {
    interstitialStartDelayMs: number;
    interstitialIntervalMs: number;
    interstitialAfterRewardedMs: number;
    errorBackoffMs: Record<number, number>;
}

export const DEFAULT_AD_POLICY: AdPolicyOptions = {
    interstitialStartDelayMs: 30000,
    interstitialIntervalMs: 60000,
    interstitialAfterRewardedMs: 60000,
    errorBackoffMs: { 2002: 30000 },
};

export class AdPolicy {
    private options: AdPolicyOptions;
    private readonly startedAt: number;
    private lastInterstitial = -Infinity;
    private lastRewarded = -Infinity;
    private blockedUntil = -Infinity;

    constructor(
        options: Partial<AdPolicyOptions> = {},
        private readonly now: () => number = Date.now,
    ) {
        this.options = { ...DEFAULT_AD_POLICY, ...options };
        this.startedAt = now();
    }

    configure(options: Partial<AdPolicyOptions>) {
        this.options = { ...this.options, ...options };
    }

    /** 返回 0 表示可展示插屏，否则为还需等待的毫秒数 */
    interstitialWaitMs(): number {
        const now = this.now();
        const { interstitialStartDelayMs, interstitialIntervalMs, interstitialAfterRewardedMs } = this.options;
        const readyAt = Math.max(
            this.startedAt + interstitialStartDelayMs,
            this.lastInterstitial + interstitialIntervalMs,
            this.lastRewarded + interstitialAfterRewardedMs,
            this.blockedUntil,
        );
        return Math.max(0, readyAt - now);
    }

    recordInterstitialShown() {
        this.lastInterstitial = this.now();
    }

    recordRewardedShown() {
        this.lastRewarded = this.now();
    }

    recordInterstitialError(errCode: number | undefined) {
        if (errCode === undefined) return;
        const backoff = this.options.errorBackoffMs[errCode];
        if (backoff) this.blockedUntil = Math.max(this.blockedUntil, this.now() + backoff);
    }
}
