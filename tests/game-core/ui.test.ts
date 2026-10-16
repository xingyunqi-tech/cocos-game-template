import { describe, expect, it, vi } from 'vitest';
import { toDesignInset } from 'db://game-core/ui/inset';
import { Settings, type AudioSwitches } from 'db://game-core/ui/Settings';
import { splitLines } from 'db://game-core/ui/text';

describe('toDesignInset', () => {
    it('uses the default padding without platform insets', () => {
        expect(toDesignInset({ safeTop: 0 }, 390, 720)).toEqual({ top: 20, safeTop: 20 });
        expect(toDesignInset({ safeTop: 0 }, 390, 720, 0)).toEqual({ top: 0, safeTop: 0 });
    });

    it('scales the safe top to design units', () => {
        expect(toDesignInset({ safeTop: 39 }, 390, 720)).toEqual({ top: 72, safeTop: 72 });
    });

    it('places content below the capsule button', () => {
        const inset = toDesignInset({ safeTop: 47, menuRect: { left: 281, top: 51, width: 87, height: 32 } }, 375, 750);
        expect(inset.menuRect).toEqual({ left: 562, top: 102, width: 174, height: 64 });
        expect(inset.top).toBe(102 + 64 + 8);
        expect(inset.safeTop).toBe(94);
    });

    it('treats an unknown window width as scale 1', () => {
        expect(toDesignInset({ safeTop: 30 }, 0, 720)).toEqual({ top: 30, safeTop: 30 });
    });
});

describe('Settings', () => {
    function setup(audio: AudioSwitches | null = null) {
        let saved = { vibrate: true };
        const vibrate = vi.fn();
        const settings = new Settings(() => audio, { get: () => saved, set: (v) => (saved = v) }, vibrate);
        return { settings, vibrate, saved: () => saved };
    }

    it('reads and writes audio switches', () => {
        const state = { music: true, effect: true };
        const { settings } = setup({
            getMusic: () => state.music,
            setMusic: (on) => (state.music = on),
            getEffect: () => state.effect,
            setEffect: (on) => (state.effect = on),
        });
        const listener = vi.fn();
        settings.onChange(listener);
        settings.music = false;
        settings.effect = false;
        expect(state).toEqual({ music: false, effect: false });
        expect([settings.music, settings.effect]).toEqual([false, false]);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('defaults audio switches to on before audio is ready', () => {
        const { settings } = setup(null);
        expect(settings.music).toBe(true);
        expect(() => (settings.music = false)).not.toThrow();
    });

    it('skips vibration when disabled', () => {
        const { settings, vibrate, saved } = setup();
        settings.vibrate('long');
        settings.vibration = false;
        settings.vibrate();
        expect(vibrate.mock.calls).toEqual([['long']]);
        expect(saved()).toEqual({ vibrate: false });
    });
});

describe('splitLines', () => {
    it('splits long documents into lines and keeps blank lines', () => {
        const text = Array.from({ length: 300 }, (_, i) => `第 ${i + 1} 行`).join('\r\n') + '\n\n';
        const lines = splitLines(text);
        expect(lines).toHaveLength(300);
        expect(lines[299]).toBe('第 300 行');
        expect(splitLines('a  \n\nb')).toEqual(['a', '', 'b']);
    });
});
