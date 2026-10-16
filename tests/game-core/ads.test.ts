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

    it('converts provider exceptions into show_failed', async () => {
        const ads = new AdService();
        ads.setProvider(provider({ needsUnitId: false, showRewarded: () => Promise.reject(new Error('x')) }));
        await expect(ads.showRewarded('x')).resolves.toEqual({ result: 'failed', reason: 'show_failed' });
        expect(ads.isShowing).toBe(false);
    });
});
