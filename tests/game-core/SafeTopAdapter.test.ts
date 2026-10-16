import { describe, expect, it, vi } from 'vitest';

class FakeWidget {
    enabled = true;
    isAlignTop = false;
    isAlignVerticalCenter = false;
    isAlignBottom = false;
    isAbsoluteTop = true;
    isAbsoluteVerticalCenter = true;
    isAbsoluteBottom = true;
    top = 0;
    verticalCenter = 0;
    bottom = 0;
    target: unknown = null;
    node: { parent: unknown };
    updateAlignment = vi.fn();

    constructor(parentHeight: number) {
        this.node = { parent: { getComponent: () => ({ height: parentHeight }) } };
    }
}

vi.mock('cc', () => ({
    _decorator: { ccclass: () => (target: unknown) => target, property: () => undefined },
    Component: class {},
    UITransform: class {},
    Widget: class {},
}));

const { SafeTopAdapter, setSafeTopProvider } = await import('db://game-core/ui/SafeTopAdapter');

interface FakeNode {
    position: { x: number; y: number; z: number };
    setPosition(x: number, y: number, z: number): void;
}

function adapter(widget: FakeWidget | null) {
    const node = { x: 0, y: 100, z: 0 };
    const instance = new SafeTopAdapter() as unknown as {
        node: FakeNode;
        getComponent: () => FakeWidget | null;
        apply(): void;
    };
    instance.node = {
        position: node,
        setPosition: (x: number, y: number, z: number) => Object.assign(node, { x, y, z }),
    };
    instance.getComponent = () => widget;
    return { instance, node };
}

describe('SafeTopAdapter', () => {
    it('adjusts absolute and percent vertical alignment by the change in inset', () => {
        let inset = 40;
        setSafeTopProvider(() => inset);
        const top = Object.assign(new FakeWidget(1000), { isAlignTop: true, top: 10 });
        const a = adapter(top);
        a.instance.apply();
        expect(top.top).toBe(50);
        inset = 60;
        a.instance.apply();
        expect(top.top).toBe(70);
        expect(top.updateAlignment).toHaveBeenCalledTimes(2);

        const percent = Object.assign(new FakeWidget(1000), { isAlignTop: true, isAbsoluteTop: false, top: 0.1 });
        adapter(percent).instance.apply();
        expect(percent.top).toBeCloseTo(0.16);

        const center = Object.assign(new FakeWidget(1000), { isAlignVerticalCenter: true, verticalCenter: 200 });
        adapter(center).instance.apply();
        expect(center.verticalCenter).toBe(140);

        const bottom = Object.assign(new FakeWidget(1000), {
            isAlignBottom: true,
            isAbsoluteBottom: false,
            bottom: 0.5,
        });
        adapter(bottom).instance.apply();
        expect(bottom.bottom).toBeCloseTo(0.44);
    });

    it('moves the node when there is no enabled vertical widget', () => {
        setSafeTopProvider(() => 30);
        const plain = adapter(null);
        plain.instance.apply();
        expect(plain.node.y).toBe(70);
        const horizontal = Object.assign(new FakeWidget(1000), { isAlignTop: false });
        const h = adapter(horizontal);
        h.instance.apply();
        expect(h.node.y).toBe(70);
        const disabled = Object.assign(new FakeWidget(1000), { enabled: false, isAlignTop: true });
        const d = adapter(disabled);
        d.instance.apply();
        expect(d.node.y).toBe(70);
        expect(disabled.top).toBe(0);
    });
});
