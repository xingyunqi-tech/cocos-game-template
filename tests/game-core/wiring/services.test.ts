import { beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => {
    const log: string[] = [];
    const source = { clip: null as { name: string } | null, playing: false };
    let on = true;
    const music = {
        getSwitch: () => on,
        setSwitch: (value: boolean) => {
            on = value;
            if (!value) source.playing = false;
        },
        stop: () => (source.playing = false),
        pause: () => {
            source.playing = false;
            log.push('pause');
        },
        resume: () => {
            source.playing = true;
            log.push('resume');
        },
        getComponent: () => source,
    };
    const playMusic = (clip: { name: string }) => {
        if (!on) return;
        source.clip = clip;
        source.playing = true;
        log.push(clip.name);
    };
    return { log, source, music, playMusic };
});
const memory = vi.hoisted(() => new Map<string, string>());

vi.mock('cc', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    AudioClip: class {},
    AudioSource: class {},
    sys: {
        localStorage: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => memory.set(key, value),
            removeItem: (key: string) => memory.delete(key),
        },
    },
}));
vi.mock('db://oops-framework/core/Oops', () => ({
    oops: {
        audio: {
            music: audio.music,
            effect: { getSwitch: () => true, setSwitch: () => undefined },
            save: () => undefined,
            playMusic: audio.playMusic,
            playEffect: () => ({}),
        },
    },
}));
vi.mock('db://game-core/config/Bundles', () => ({
    loadAsset: (_bundle: string, path: string) => Promise.resolve({ name: path, addRef() {}, decRef() {} }),
    assertReleasable: () => undefined,
    unloadBundle: () => true,
}));
vi.mock('db://game-core/ui/kit', () => ({
    setButtonClickHook: () => undefined,
    visibleSize: () => ({ width: 750, height: 1334 }),
}));
vi.mock('db://game-core/ui/ConfirmDialog', () => ({ showConfirm: () => Promise.resolve(true) }));
vi.mock('db://game-core/ui/SafeTopAdapter', () => ({ setSafeTopProvider: () => undefined }));
vi.mock('db://game-core/compliance/HealthNotice', () => ({ HealthNotice: class {} }));

const { settings, sound, releaseBundle, usePlatform, useStore, platform, ads, deviceSave, onPlatformShow } =
    await import('db://game-core/wiring/services');
const services = await import('db://game-core/wiring/services');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function toggleMusic() {
    settings.music = false;
    audio.log.length = 0;
    settings.music = true;
    await tick();
}

beforeEach(async () => {
    sound.stopMusic();
    settings.music = true;
    await tick();
    audio.log.length = 0;
});

describe('settings music switch', () => {
    it('plays the music requested while the switch was off', async () => {
        await sound.playMusic({ bundle: 'b', path: 'A' });
        settings.music = false;
        await sound.playMusic({ bundle: 'b', path: 'B' });
        settings.music = true;
        await tick();
        expect(audio.log).toEqual(['A', 'B']);
    });

    it('stays silent after the music was stopped', async () => {
        await sound.playMusic({ bundle: 'b', path: 'A' });
        sound.stopMusic();
        await toggleMusic();
        expect(audio.log).toEqual([]);
    });

    it('stays silent after the music bundle was released', async () => {
        await sound.playMusic({ bundle: 'b', path: 'A' });
        releaseBundle('b');
        await toggleMusic();
        expect(audio.log).toEqual([]);
    });

    it('does not restart music when switched on while already on', async () => {
        await sound.playMusic({ bundle: 'b', path: 'A' });
        settings.music = true;
        await tick();
        expect(audio.log).toEqual(['A']);
    });
});

describe('platform and store injection', () => {
    it('routes ads and the shared platform binding to an injected platform', async () => {
        const showRewarded = vi.fn(() => Promise.resolve({ result: 'completed' as const }));
        const injected = {
            ...platform,
            name: 'web' as const,
            ads: { needsUnitId: false, showRewarded, showInterstitial: vi.fn() },
            monotonicNow: () => 1000,
        };
        usePlatform(injected);
        expect(services.platform).toBe(injected);
        await expect(ads.showRewarded('any')).resolves.toEqual({ result: 'completed' });
        expect(showRewarded).toHaveBeenCalledWith('any');
    });

    it('moves onShow subscriptions to an injected platform', () => {
        const oldShows: Array<() => void> = [];
        const newShows: Array<() => void> = [];
        const base = Object.assign(Object.create(platform) as typeof platform, {
            onShow: (l: () => void) => (oldShows.push(l), () => undefined),
        });
        usePlatform(base);
        const listener = vi.fn();
        onPlatformShow(listener);
        usePlatform(
            Object.assign(Object.create(platform) as typeof platform, {
                onShow: (l: () => void) => (newShows.push(l), () => undefined),
            }),
        );
        expect(oldShows).toEqual([listener]);
        expect(newShows).toEqual([listener]);
    });

    it('flushes pending writes to the previous store before switching and rereads afterwards', () => {
        const slot = deviceSave.slot('switching', { version: 1, defaults: () => ({ n: 0 }) });
        slot.set({ n: 1 });
        const data = new Map<string, string>([['gc:d:switching', JSON.stringify({ v: 1, d: { n: 9 } })]]);
        useStore({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        });
        expect(JSON.parse(memory.get('gc:d:switching')!)).toEqual({ v: 1, d: { n: 1 } });
        expect(slot.get()).toEqual({ n: 9 });
    });

    it('reads and writes saves through an injected store', () => {
        const data = new Map<string, string>();
        useStore({
            getItem: (key) => data.get(key) ?? null,
            setItem: (key, value) => void data.set(key, value),
            removeItem: (key) => void data.delete(key),
        });
        const slot = deviceSave.slot('injected', { version: 1, defaults: () => ({ n: 0 }) });
        slot.set({ n: 3 });
        deviceSave.flush();
        expect(JSON.parse(data.get('gc:d:injected')!)).toEqual({ v: 1, d: { n: 3 } });
        expect(memory.has('gc:d:injected')).toBe(false);
    });
});

describe('ads and background music', () => {
    it('pauses playing music while a platform ad shows and resumes it afterwards', async () => {
        let finish: () => void = () => undefined;
        ads.setProvider({
            needsUnitId: false,
            showRewarded: () => new Promise((resolve) => (finish = () => resolve({ result: 'completed' }))),
            showInterstitial: () => Promise.resolve({ result: 'shown' }),
        });
        await sound.playMusic({ bundle: 'b', path: 'A' });
        audio.log.length = 0;
        const pending = ads.showRewarded('any');
        expect(audio.log).toEqual(['pause']);
        finish();
        await pending;
        expect(audio.log).toEqual(['pause', 'resume']);
    });

    it('does not resume music that was stopped, replaced or switched off during an ad', async () => {
        const finishers: Array<() => void> = [];
        ads.setProvider({
            needsUnitId: false,
            showRewarded: () => new Promise((resolve) => finishers.push(() => resolve({ result: 'completed' }))),
            showInterstitial: () => Promise.resolve({ result: 'shown' }),
        });
        const during = async (change: () => void | Promise<unknown>) => {
            settings.music = true;
            await sound.playMusic({ bundle: 'b', path: 'A' });
            const pending = ads.showRewarded('any');
            await change();
            audio.log.length = 0;
            finishers.shift()?.();
            await pending;
            return audio.log.slice();
        };
        expect(await during(() => sound.stopMusic())).toEqual([]);
        expect(
            await during(() => {
                settings.music = false;
            }),
        ).toEqual([]);
        expect(await during(() => sound.playMusic({ bundle: 'b', path: 'B' }))).toEqual([]);
    });

    it('leaves stopped music alone during an ad', async () => {
        ads.setProvider({
            needsUnitId: false,
            showRewarded: () => Promise.resolve({ result: 'completed' }),
            showInterstitial: () => Promise.resolve({ result: 'shown' }),
        });
        sound.stopMusic();
        audio.log.length = 0;
        await ads.showRewarded('any');
        expect(audio.log).toEqual([]);
    });
});
