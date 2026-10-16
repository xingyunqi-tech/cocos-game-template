import { beforeEach, describe, expect, it, vi } from 'vitest';

const loads: Record<string, (clip: unknown) => void> = {};
const played: string[] = [];

vi.mock('cc', () => ({ AudioClip: class {} }));
vi.mock('db://game-core/config/Bundles', () => ({
    loadAsset: (_bundle: string, path: string) =>
        new Promise((resolve) => {
            loads[path] = resolve;
        }),
}));
vi.mock('db://oops-framework/core/Oops', () => ({
    oops: {
        audio: {
            music: { getSwitch: () => true, stop: () => undefined },
            playMusic: (clip: { name: string }) => played.push(clip.name),
        },
    },
}));

const { SoundService } = await import('db://game-core/ui/Sound');

const clip = (name: string) => ({ name, addRef: () => undefined });
const ref = (path: string) => ({ bundle: 'b', path });

beforeEach(() => {
    played.length = 0;
});

describe('SoundService', () => {
    it('plays only the latest music when an earlier clip finishes loading later', async () => {
        const sound = new SoundService();
        const first = sound.playMusic(ref('a'));
        const second = sound.playMusic(ref('b'));
        loads.b(clip('b'));
        await expect(second).resolves.toBe(true);
        loads.a(clip('a'));
        await expect(first).resolves.toBe(false);
        expect(played).toEqual(['b']);
    });

    it('does not play music whose clip finishes loading after stopMusic', async () => {
        const sound = new SoundService();
        const pending = sound.playMusic(ref('c'));
        sound.stopMusic();
        loads.c(clip('c'));
        await expect(pending).resolves.toBe(false);
        expect(played).toEqual([]);
    });
});
