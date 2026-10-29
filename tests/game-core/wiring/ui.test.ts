import { describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => ({ settings: 0, documents: [] as string[] }));

vi.mock('db://oops-framework/core/Oops', () => ({ oops: { gui: { toast: () => undefined } } }));
vi.mock('db://game-core/ui/DocumentPage', () => ({
    openDocument: (kind: string) => {
        opened.documents.push(`default:${kind}`);
        return Promise.resolve();
    },
}));
vi.mock('db://game-core/ui/SettingsPanel', () => ({ openSettings: () => void opened.settings++ }));
vi.mock('db://game-core/ui/OfflineBanner', () => ({ OfflineBanner: class {} }));
vi.mock('db://game-core/ui/SidebarEntry', () => ({ createSidebarEntry: () => null }));
vi.mock('db://game-core/wiring/sidebar', () => ({ sidebar: {} }));
vi.mock('db://game-core/wiring/services', () => ({
    confirm: () => Promise.resolve(true),
    coreOptions: { settingsTitle: '设置' },
    getDesignInset: () => ({ top: 0 }),
    platform: { name: 'web' },
    setConfirmProvider: () => undefined,
    settings: {},
}));

const { coreUi } = await import('db://game-core/wiring/ui');

describe('coreUi providers', () => {
    it('uses the template settings panel and documents until replaced', async () => {
        coreUi.openSettings();
        await coreUi.openDocument('privacy');
        expect(opened).toEqual({ settings: 1, documents: ['default:privacy'] });

        const settings = vi.fn();
        const documents = vi.fn();
        coreUi.setSettings(settings);
        coreUi.setDocument(documents);
        coreUi.openSettings();
        await coreUi.openDocument('agreement');
        expect(settings).toHaveBeenCalledOnce();
        expect(documents).toHaveBeenCalledWith('agreement');
        expect(opened).toEqual({ settings: 1, documents: ['default:privacy'] });
    });

    it('turns a provider that throws into a rejected promise', async () => {
        coreUi.setDocument(() => {
            throw new Error('broken');
        });
        await expect(coreUi.openDocument('privacy')).rejects.toThrow('broken');
    });
});
