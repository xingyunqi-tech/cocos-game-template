import { describe, expect, it, vi } from 'vitest';
import { PrivacyFlow } from 'db://game-core/compliance/PrivacyFlow';
import { SidebarReward } from 'db://game-core/compliance/SidebarReward';
import type { IPlatform, PrivacyHandler, PrivacySetting } from 'db://game-core/platform/types';

function privacyPlatform(options: { supported?: boolean; setting?: PrivacySetting | Error } = {}) {
    let handler: PrivacyHandler | undefined;
    const platform = {
        onNeedPrivacyAuthorization: (h: PrivacyHandler) => {
            if (options.supported === false) return false;
            handler = h;
            return true;
        },
        getPrivacySetting: () =>
            options.setting instanceof Error
                ? Promise.reject(options.setting)
                : Promise.resolve(options.setting ?? { supported: true, needAuthorization: true }),
        openPrivacyContract: vi.fn(() => Promise.resolve(true)),
    };
    return {
        platform: platform as unknown as IPlatform,
        openContract: platform.openPrivacyContract,
        trigger: (resolve: (agree: boolean) => void, exposed = vi.fn()) => handler?.(resolve, exposed),
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PrivacyFlow', () => {
    it('uses the official popup by default', () => {
        const flow = new PrivacyFlow({ platform: () => privacyPlatform().platform });
        expect(flow.custom).toBe(false);
    });

    it('resolves agree and disagree from the custom prompt after exposure', async () => {
        const p = privacyPlatform();
        const onDecision = vi.fn();
        const flow = new PrivacyFlow({ platform: () => p.platform, onDecision });
        const prompt = vi.fn(({ openContract }: { openContract: () => void }) => {
            openContract();
            return Promise.resolve(true);
        });
        expect(flow.useCustomPrompt(prompt)).toBe(true);
        const resolve = vi.fn();
        const exposed = vi.fn();
        p.trigger(resolve, exposed);
        await flush();
        expect(exposed).toHaveBeenCalledBefore(resolve);
        expect(resolve).toHaveBeenCalledWith(true);
        expect(p.openContract).toHaveBeenCalled();

        flow.useCustomPrompt(() => Promise.resolve(false));
        const second = vi.fn();
        p.trigger(second);
        await flush();
        expect(second).toHaveBeenCalledWith(false);
        expect(onDecision.mock.calls).toEqual([[true], [false]]);
    });

    it('shares one prompt between concurrent requests', async () => {
        const p = privacyPlatform();
        let answer!: (agree: boolean) => void;
        const prompt = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
        new PrivacyFlow({ platform: () => p.platform }).useCustomPrompt(prompt);
        const a = vi.fn();
        const b = vi.fn();
        p.trigger(a);
        p.trigger(b);
        await flush();
        answer(true);
        await flush();
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(a).toHaveBeenCalledWith(true);
        expect(b).toHaveBeenCalledWith(true);
    });

    it('falls back to the in-game page when the platform cannot open the guide', async () => {
        const p = privacyPlatform();
        p.openContract.mockResolvedValue(false);
        const fallbackContract = vi.fn();
        new PrivacyFlow({ platform: () => p.platform, fallbackContract }).useCustomPrompt(({ openContract }) => {
            openContract();
            return Promise.resolve(false);
        });
        p.trigger(vi.fn());
        await flush();
        expect(fallbackContract).toHaveBeenCalledTimes(1);
    });

    it('treats a failing prompt as disagree', async () => {
        const p = privacyPlatform();
        new PrivacyFlow({ platform: () => p.platform }).useCustomPrompt(() => Promise.reject(new Error('x')));
        const resolve = vi.fn();
        p.trigger(resolve);
        await flush();
        expect(resolve).toHaveBeenCalledWith(false);
    });

    it('keeps the official popup when custom prompts are unsupported', () => {
        const flow = new PrivacyFlow({ platform: () => privacyPlatform({ supported: false }).platform });
        expect(flow.useCustomPrompt(() => Promise.resolve(true))).toBe(false);
        expect(flow.custom).toBe(false);
    });

    it('requires authorization through the platform, or passes when the platform has no such API', async () => {
        const base = privacyPlatform().platform;
        const granted = Object.assign(Object.create(base) as typeof base, {
            requirePrivacyAuthorize: () => Promise.resolve(false),
        });
        const failing = Object.assign(Object.create(base) as typeof base, {
            requirePrivacyAuthorize: () => Promise.reject(new Error('x')),
        });
        await expect(new PrivacyFlow({ platform: () => granted }).require()).resolves.toBe(false);
        await expect(new PrivacyFlow({ platform: () => failing }).require()).resolves.toBe(false);
        await expect(new PrivacyFlow({ platform: () => base }).require()).resolves.toBe(true);
    });

    it('reports whether authorization is needed', async () => {
        const make = (setting: PrivacySetting | Error) =>
            new PrivacyFlow({ platform: () => privacyPlatform({ setting }).platform }).needAuthorization();
        await expect(make({ supported: true, needAuthorization: true })).resolves.toBe(true);
        await expect(make({ supported: false, needAuthorization: true })).resolves.toBe(false);
        await expect(make(new Error('x'))).resolves.toBe(false);
    });
});

describe('SidebarReward', () => {
    function setup(fromSidebar: boolean) {
        let saved = { lastClaimDay: '' };
        let day = '2026-10-15';
        let launched = fromSidebar;
        const reward = new SidebarReward({
            store: { get: () => saved, set: (v) => (saved = v) },
            launchedFromSidebar: () => launched,
            today: () => day,
        });
        return {
            reward,
            setDay: (d: string) => (day = d),
            setLaunched: (v: boolean) => (launched = v),
            saved: () => saved,
        };
    }

    it('allows one claim per day when launched from the sidebar', () => {
        const s = setup(true);
        expect(s.reward.canClaim()).toBe(true);
        expect(s.reward.claim()).toBe(true);
        expect(s.saved()).toEqual({ lastClaimDay: '2026-10-15' });
        expect(s.reward.claim()).toBe(false);
        s.setDay('2026-10-16');
        expect(s.reward.claim()).toBe(true);
    });

    it('counts a rolled back date as already claimed', () => {
        const s = setup(true);
        s.reward.claim();
        s.setDay('2026-10-14');
        expect(s.reward.claimedToday()).toBe(true);
        expect(s.reward.claim()).toBe(false);
    });

    it('uses the local date when no day source is given', () => {
        let saved = { lastClaimDay: '' };
        const reward = new SidebarReward({
            store: { get: () => saved, set: (v) => (saved = v) },
            launchedFromSidebar: () => true,
        });
        expect(reward.claim()).toBe(true);
        expect(saved.lastClaimDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('does not allow claims before saves are ready', () => {
        let ready = false;
        let saved = { lastClaimDay: '' };
        const reward = new SidebarReward({
            store: { get: () => saved, set: (v) => (saved = v) },
            launchedFromSidebar: () => true,
            ready: () => ready,
            today: () => '2026-10-15',
        });
        expect(reward.claim()).toBe(false);
        ready = true;
        expect(reward.claim()).toBe(true);
    });

    it('does not allow claims from other entries', () => {
        const s = setup(false);
        expect(s.reward.canClaim()).toBe(false);
        expect(s.reward.claim()).toBe(false);
        s.setLaunched(true);
        expect(s.reward.claimedToday()).toBe(false);
        expect(s.reward.claim()).toBe(true);
    });
});
