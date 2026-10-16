import { beforeEach, describe, expect, it, vi } from 'vitest';

const loads: Record<string, (clip: unknown) => void> = {};
const played: string[] = [];
const music = { stopped: 0 };

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
            playMusic: (clip: { name: string }) => played.push(clip.name),
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
});
