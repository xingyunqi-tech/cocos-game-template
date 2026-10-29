import { describe, expect, it, vi } from 'vitest';
import { AdPolicy } from 'db://game-core/ads/AdPolicy';
import { AdService } from 'db://game-core/ads/AdService';
import type { AdProvider, InterstitialResult, RewardedResult } from 'db://game-core/platform/types';

function clock(start = 0) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
}

function provider(overrides: Partial<AdProvider> = {}) {
    const rewarded = vi.fn((unitId: string) => {
        void unitId;
        return Promise.resolve<RewardedResult>({ result: 'completed' });
    });
    const interstitial = vi.fn((unitId: string) => {
        void unitId;
        return Promise.resolve<InterstitialResult>({ result: 'shown' });
    });
    const p: AdProvider = { needsUnitId: true, showRewarded: rewarded, showInterstitial: interstitial, ...overrides };
    return Object.assign(p, { rewarded, interstitial });
}

describe('AdPolicy', () => {
    it('blocks interstitials during the first 30 seconds', () => {
        const c = clock();
        const policy = new AdPolicy({}, c.now);
        expect(policy.interstitialWaitMs()).toBe(30000);
        c.advance(30000);
        expect(policy.interstitialWaitMs()).toBe(0);
    });

    it('keeps 60 seconds between interstitials and after rewarded ads', () => {
        const c = clock();
        const policy = new AdPolicy({}, c.now);
        c.advance(40000);
        policy.recordInterstitialShown();
        c.advance(59999);
        expect(policy.interstitialWaitMs()).toBe(1);
        c.advance(1);
        policy.recordRewardedShown();
        c.advance(30000);
        expect(policy.interstitialWaitMs()).toBe(30000);
    });

    it('backs off after error 2002 only', () => {
        const c = clock();
        const policy = new AdPolicy({ interstitialStartDelayMs: 0 }, c.now);
        policy.recordInterstitialError(1004);
        expect(policy.interstitialWaitMs()).toBe(0);
        policy.recordInterstitialError(2002);
        expect(policy.interstitialWaitMs()).toBe(30000);
    });
});

describe('AdPolicy clock', () => {
    it('restarts all timers from the new clock', () => {
        const old = clock(1_000_000);
        const policy = new AdPolicy({}, old.now);
        old.advance(40000);
        policy.recordInterstitialShown();
        const fresh = clock(50);
        policy.useClock(fresh.now);
        expect(policy.interstitialWaitMs()).toBe(30000);
        fresh.advance(30000);
        expect(policy.interstitialWaitMs()).toBe(0);
    });
});

describe('AdService', () => {
    it('maps placements to unit ids and reports results', async () => {
        const onResult = vi.fn();
        const p = provider();
        const ads = new AdService({ onResult });
        ads.setProvider(p);
        ads.configure({ rewarded: { revive: 'adunit-1' } });
        await expect(ads.showRewarded('revive')).resolves.toEqual({ result: 'completed' });
        expect(p.rewarded).toHaveBeenCalledWith('adunit-1');
        expect(onResult).toHaveBeenCalledWith('rewarded', 'revive', { result: 'completed' });
    });

    it('distinguishes unsupported, not configured and busy', async () => {
        const ads = new AdService();
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'unsupported' });
        let finish!: (r: RewardedResult) => void;
        ads.setProvider(provider({ showRewarded: () => new Promise((resolve) => (finish = resolve)) }));
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'not_configured' });
        ads.configure({ rewarded: { x: 'u' } });
        const first = ads.showRewarded('x');
        expect(ads.isShowing).toBe(true);
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'busy' });
        finish({ result: 'skipped' });
        await expect(first).resolves.toEqual({ result: 'skipped' });
        expect(ads.isShowing).toBe(false);
    });

    it('passes the placement through when the provider needs no unit id', async () => {
        const p = provider({ needsUnitId: false });
        const ads = new AdService({ policy: new AdPolicy({ interstitialStartDelayMs: 0 }) });
        ads.setProvider(p);
        await ads.showInterstitial('level_end');
        expect(p.interstitial).toHaveBeenCalledWith('level_end');
    });

    it('applies interstitial frequency control', async () => {
        const c = clock();
        const p = provider();
        const ads = new AdService({ policy: new AdPolicy({}, c.now) });
        ads.setProvider(p);
        ads.configure({ interstitial: { end: 'i1' }, rewarded: { revive: 'r1' } });
        await expect(ads.showInterstitial('end')).resolves.toEqual({ result: 'failed', reason: 'frequency' });
        c.advance(30000);
        await expect(ads.showInterstitial('end')).resolves.toEqual({ result: 'shown' });
        c.advance(60000);
        await ads.showRewarded('revive');
        c.advance(10000);
        await expect(ads.showInterstitial('end')).resolves.toEqual({ result: 'failed', reason: 'frequency' });
        expect(p.interstitial).toHaveBeenCalledTimes(1);
    });

    it('does not count failed rewarded ads and backs off on 2002', async () => {
        const c = clock();
        const p = provider({
            showRewarded: () => Promise.resolve({ result: 'failed', reason: 'show_failed', errCode: 1004 }),
            showInterstitial: () => Promise.resolve({ result: 'failed', reason: 'show_failed', errCode: 2002 }),
        });
        const ads = new AdService({ policy: new AdPolicy({ interstitialStartDelayMs: 0 }, c.now) });
        ads.setProvider(p);
        ads.configure({ interstitial: { end: 'i1' }, rewarded: { revive: 'r1' } });
        await ads.showRewarded('revive');
        expect(ads.policy.interstitialWaitMs()).toBe(0);
        await ads.showInterstitial('end');
        expect(ads.policy.interstitialWaitMs()).toBe(30000);
    });

    it('returns simulated results without calling the provider', async () => {
        const p = provider();
        const ads = new AdService();
        ads.setProvider(p);
        ads.simulate = 'skipped';
        await expect(ads.showRewarded('any')).resolves.toEqual({ result: 'skipped' });
        await expect(ads.showInterstitial('any')).resolves.toEqual({ result: 'shown' });
        ads.simulate = 'failed';
        await expect(ads.showRewarded('any')).resolves.toEqual({ result: 'failed', reason: 'unsupported' });
        expect(p.rewarded).not.toHaveBeenCalled();
        expect(p.interstitial).not.toHaveBeenCalled();
    });

    it('converts provider exceptions into show_failed', async () => {
        const ads = new AdService();
        ads.setProvider(provider({ needsUnitId: false, showRewarded: () => Promise.reject(new Error('x')) }));
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'show_failed' });
        expect(ads.isShowing).toBe(false);
    });

    it('waits without a time limit when the timeout is Infinity', async () => {
        vi.useFakeTimers();
        try {
            const ads = new AdService();
            let finish: (result: RewardedResult) => void = () => undefined;
            ads.setProvider(
                provider({
                    needsUnitId: false,
                    showRewarded: () => new Promise<RewardedResult>((resolve) => (finish = resolve)),
                }),
            );
            ads.configure({ showTimeoutMs: Infinity });
            const pending = ads.showRewarded('x');
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            expect(ads.isShowing).toBe(true);
            finish({ result: 'completed' });
            await expect(pending).resolves.toEqual({ result: 'completed' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('preloads configured rewarded placements and reports platform showing state', async () => {
        const preloadRewarded = vi.fn();
        const showing: boolean[] = [];
        const ads = new AdService({ onShowingChange: (value) => showing.push(value) });
        ads.setProvider(provider({ preloadRewarded }));
        ads.configure({ rewarded: { revive: 'unit-r' } });
        ads.preloadRewarded('revive');
        ads.preloadRewarded('unknown');
        expect(preloadRewarded.mock.calls).toEqual([['unit-r']]);
        await ads.showRewarded('revive');
        ads.simulate = 'completed';
        await ads.showRewarded('revive');
        expect(showing).toEqual([true, false]);
    });

    it('reports the end of showing and accepts new ads when the provider throws synchronously', async () => {
        const showing: boolean[] = [];
        const ads = new AdService({ onShowingChange: (value) => showing.push(value) });
        ads.setProvider(
            provider({
                needsUnitId: false,
                showRewarded: () => {
                    throw new Error('sdk missing');
                },
            }),
        );
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'show_failed' });
        expect(showing).toEqual([true, false]);
        expect(ads.isShowing).toBe(false);
    });

    it('reports the platform result that arrives after a timeout', async () => {
        vi.useFakeTimers();
        try {
            const ads = new AdService();
            const late = vi.fn();
            ads.onLateResult(late);
            let finish: (result: RewardedResult) => void = () => undefined;
            ads.setProvider(
                provider({
                    needsUnitId: false,
                    showRewarded: () => new Promise<RewardedResult>((resolve) => (finish = resolve)),
                }),
            );
            ads.configure({ showTimeoutMs: 1000, policy: { interstitialStartDelayMs: 0 } });
            const pending = ads.showRewarded('revive');
            await vi.advanceTimersByTimeAsync(1000);
            await expect(pending).resolves.toEqual({ result: 'failed', reason: 'timeout' });
            expect(late).not.toHaveBeenCalled();
            expect(ads.policy.interstitialWaitMs()).toBe(60000);
            await vi.advanceTimersByTimeAsync(30000);
            finish({ result: 'completed' });
            await vi.advanceTimersByTimeAsync(0);
            expect(late).toHaveBeenCalledWith('rewarded', 'revive', { result: 'completed' });
            expect(ads.policy.interstitialWaitMs()).toBe(60000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails with timeout and accepts new ads when the provider never settles', async () => {
        vi.useFakeTimers();
        try {
            const ads = new AdService();
            const stuck = provider({
                needsUnitId: false,
                showRewarded: () => new Promise<RewardedResult>(() => undefined),
            });
            ads.setProvider(stuck);
            ads.configure({ showTimeoutMs: 1000 });
            const pending = ads.showRewarded('x');
            await vi.advanceTimersByTimeAsync(999);
            expect(ads.isShowing).toBe(true);
            await vi.advanceTimersByTimeAsync(1);
            await expect(pending).resolves.toEqual({ result: 'failed', reason: 'timeout' });
            expect(ads.isShowing).toBe(false);
            ads.setProvider(provider({ needsUnitId: false }));
            await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'completed' });
        } finally {
            vi.useRealTimers();
        }
    });
});
