import { beforeEach, describe, expect, it, vi } from 'vitest';

const loads: Record<string, (clip: unknown) => void> = {};
const played: string[] = [];
const music: { stopped: number; complete?: () => void } = { stopped: 0 };

vi.mock('cc', () => ({ AudioClip: class {} }));
vi.mock('db://game-core/config/Bundles', () => ({
    loadAsset: (bundle: string, path: string) =>
        new Promise((resolve) => {
            loads[`${bundle}/${path}`] = resolve;
        }),
}));
vi.mock('db://oops-framework/core/Oops', () => ({
    oops: {
        audio: {
            music: { getSwitch: () => true, stop: () => void music.stopped++ },
            playMusic: (clip: { name: string }, params?: { onPlayComplete?: () => void }) => {
                played.push(clip.name);
                music.complete = params?.onPlayComplete;
            },
            playEffect: () => ({}),
        },
    },
}));

const { SoundService } = await import('db://game-core/ui/Sound');

const clip = (name: string) => ({
    name,
    refs: 0,
    addRef() {
        this.refs++;
    },
    decRef() {
        this.refs--;
    },
});
const ref = (path: string, bundle = 'b') => ({ bundle, path });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    played.length = 0;
    music.stopped = 0;
});

describe('SoundService', () => {
    it('plays only the latest music when an earlier clip finishes loading later', async () => {
        const sound = new SoundService();
        const first = sound.playMusic(ref('a'));
        const second = sound.playMusic(ref('b'));
        loads['b/b'](clip('b'));
        await expect(second).resolves.toBe(true);
        loads['b/a'](clip('a'));
        await expect(first).resolves.toBe(false);
        expect(played).toEqual(['b']);
    });

    it('does not play music whose clip finishes loading after stopMusic', async () => {
        const sound = new SoundService();
        const pending = sound.playMusic(ref('c'));
        sound.stopMusic();
        loads['b/c'](clip('c'));
        await expect(pending).resolves.toBe(false);
        expect(played).toEqual([]);
    });

    it('forgets clips of a released bundle, returns their references and stops its music', async () => {
        const sound = new SoundService();
        const bgm = clip('bgm');
        const other = clip('other');
        const playing = sound.playMusic(ref('bgm', 'shop'));
        loads['shop/bgm'](bgm);
        await playing;
        const kept = sound.playEffect(ref('click', 'core'));
        loads['core/click'](other);
        await kept;
        sound.forgetBundle('shop');
        await flush();
        expect(music.stopped).toBe(1);
        expect(bgm.refs).toBe(0);
        expect(other.refs).toBe(1);
        await expect(sound.resumeMusic()).resolves.toBe(false);
        const again = sound.playMusic(ref('bgm', 'shop'));
        expect(loads['shop/bgm']).toBeDefined();
        loads['shop/bgm'](clip('bgm'));
        await expect(again).resolves.toBe(true);
    });

    it('forgets music that does not loop once it finishes', async () => {
        const sound = new SoundService();
        const once = sound.playMusic(ref('jingle'), false);
        loads['b/jingle'](clip('jingle'));
        await expect(once).resolves.toBe(true);
        music.complete?.();
        await expect(sound.resumeMusic()).resolves.toBe(false);
    });

    it('keeps the current music when an earlier one-shot music finishes', async () => {
        const sound = new SoundService();
        const once = sound.playMusic(ref('intro'), false);
        loads['b/intro'](clip('intro'));
        await once;
        const finishIntro = music.complete;
        const loop = sound.playMusic(ref('theme'));
        loads['b/theme'](clip('theme'));
        await loop;
        finishIntro?.();
        played.length = 0;
        const resumed = sound.resumeMusic();
        await expect(resumed).resolves.toBe(true);
        expect(played).toEqual(['theme']);
    });
});
