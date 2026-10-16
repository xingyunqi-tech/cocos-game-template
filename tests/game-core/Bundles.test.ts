import { describe, expect, it, vi } from 'vitest';

const bundles = new Map<string, { releaseAll: () => void }>();
const removed: string[] = [];

vi.mock('cc', () => ({
    Asset: class {},
    assetManager: {
        getBundle: (name: string) => bundles.get(name) ?? null,
        removeBundle: (bundle: { name: string }) => {
            removed.push(bundle.name);
            bundles.delete(bundle.name);
        },
    },
}));

const { unloadBundle } = await import('db://game-core/config/Bundles');

describe('unloadBundle', () => {
    it('releases every asset and removes a loaded bundle', () => {
        const bundle = { name: 'shop', releaseAll: vi.fn() };
        bundles.set('shop', bundle);
        expect(unloadBundle('shop')).toBe(true);
        expect(bundle.releaseAll).toHaveBeenCalledOnce();
        expect(removed).toEqual(['shop']);
        expect(unloadBundle('shop')).toBe(false);
    });

    it('refuses to release engine built-in bundles', () => {
        const resources = { name: 'resources', releaseAll: vi.fn() };
        bundles.set('resources', resources);
        for (const name of ['resources', 'main', 'internal', 'start-scene']) {
            expect(() => unloadBundle(name)).toThrow('不能释放');
        }
        expect(resources.releaseAll).not.toHaveBeenCalled();
    });
});
