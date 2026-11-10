import { describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => {
    const node = () => ({ name: '', setPosition: () => undefined });
    const buttons: Array<{ text: string; onClick: () => void }> = [];
    const close = vi.fn();
    return { node, buttons, close };
});

vi.mock('cc', () => ({
    profiler: { isShowingStats: () => false, showStats: () => undefined, hideStats: () => undefined },
}));
vi.mock('db://game-core/ui/kit', () => ({
    THEME: {},
    getLayer: () => ({ getChildByName: () => null }),
    openModal: () => ({ root: ui.node(), close: ui.close }),
    addPanel: () => ui.node(),
    addLabel: () => ({ node: ui.node() }),
    createNode: () => ui.node(),
    setButtonText: () => undefined,
    visibleSize: () => ({ width: 720, height: 1280 }),
    addButton: (_parent: unknown, text: string, onClick: () => void) => {
        ui.buttons.push({ text, onClick });
        return ui.node();
    },
}));

const { openGmPanel } = await import('db://game-core/debug/GmPanel');

function setup(restart: boolean) {
    ui.buttons.length = 0;
    ui.close.mockClear();
    let env = 'dev';
    const actions = {
        envTypes: ['dev', 'test', 'prod'],
        currentEnv: () => env,
        setEnv: vi.fn((type: string) => (env = type)),
        adSimulation: () => null,
        setAdSimulation: () => undefined,
        paySimulation: () => null,
        setPaySimulation: () => undefined,
        simulateSidebar: () => undefined,
        clearSaves: () => undefined,
        confirm: vi.fn(() => Promise.resolve(true)),
        toast: vi.fn(),
        restart: vi.fn(() => restart),
    };
    openGmPanel(actions);
    const click = async (text: string) => {
        ui.buttons.find((b) => b.text === text)!.onClick();
        await Promise.resolve();
    };
    return { actions, click };
}

describe('openGmPanel environment switch', () => {
    it('closes the panel after switching when restart is unsupported', async () => {
        const { actions, click } = setup(false);
        await click('test');
        expect(actions.setEnv).toHaveBeenCalledWith('test');
        expect(actions.toast).toHaveBeenCalled();
        expect(ui.close).toHaveBeenCalled();
    });

    it('ignores the current environment and allows switching back after a change', async () => {
        const { actions, click } = setup(true);
        await click('dev');
        expect(actions.confirm).not.toHaveBeenCalled();
        await click('test');
        await click('dev');
        expect(actions.setEnv.mock.calls).toEqual([['test'], ['dev']]);
        expect(ui.close).not.toHaveBeenCalled();
    });
});
