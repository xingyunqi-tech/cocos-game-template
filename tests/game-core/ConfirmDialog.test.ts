import { describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => {
    const transform = { height: 40, setContentSize: () => undefined };
    const node = () => ({ getComponent: () => transform, setPosition: () => undefined });
    const listeners = new Map<string, () => void>();
    const buttons: Array<{ text: string; onClick: () => void }> = [];
    const root = {
        parent: {} as object | null,
        once: (event: string, listener: () => void) => listeners.set(event, listener),
        on: (event: string, listener: () => void) => listeners.set(event, listener),
    };
    const close = vi.fn(() => {
        root.parent = null;
        listeners.get('parent-changed')?.();
    });
    return { node, listeners, buttons, root, close };
});

vi.mock('cc', () => ({
    Node: { EventType: { NODE_DESTROYED: 'node-destroyed', PARENT_CHANGED: 'parent-changed' } },
    UITransform: class {},
}));
vi.mock('db://game-core/ui/kit', () => ({
    THEME: {},
    openModal: () => ({ root: ui.root, close: ui.close }),
    addPanel: () => ui.node(),
    addLabel: () => ({ node: ui.node(), updateRenderData: () => undefined }),
    fillRect: () => undefined,
    addButton: (_parent: unknown, text: string, onClick: () => void) => {
        ui.buttons.push({ text, onClick });
        return ui.node();
    },
}));

const { showConfirm } = await import('db://game-core/ui/ConfirmDialog');

describe('showConfirm', () => {
    it('resolves with the clicked button and then closes', async () => {
        ui.buttons.length = 0;
        ui.root.parent = {};
        const result = showConfirm({ content: 'c', confirmText: 'ok' });
        ui.buttons.find((b) => b.text === 'ok')!.onClick();
        await expect(result).resolves.toBe(true);
        expect(ui.close).toHaveBeenCalled();
    });

    it('resolves false when the dialog node is destroyed elsewhere', async () => {
        const result = showConfirm({ content: 'c' });
        ui.listeners.get('node-destroyed')!();
        await expect(result).resolves.toBe(false);
    });

    it('resolves false when the dialog node is removed from its parent', async () => {
        ui.root.parent = {};
        const result = showConfirm({ content: 'c' });
        ui.listeners.get('parent-changed')!();
        ui.root.parent = null;
        ui.listeners.get('parent-changed')!();
        await expect(result).resolves.toBe(false);
    });
});
