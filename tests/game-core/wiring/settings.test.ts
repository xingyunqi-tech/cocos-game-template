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

const { settings, sound, releaseBundle } = await import('db://game-core/wiring/services');
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
