import { oops } from 'db://oops-framework/core/Oops';
import { PrivacyFlow, type PrivacyPrompt } from '../compliance/PrivacyFlow';
import { track } from '../monitor/track';
import { openDocument, type LegalDocument } from '../ui/DocumentPage';
import { OfflineBanner } from '../ui/OfflineBanner';
import { openSettings } from '../ui/SettingsPanel';
import { createSidebarEntry } from '../ui/SidebarEntry';
import { coreText } from '../ui/strings';
import {
    confirm,
    coreOptions,
    getDesignInset,
    platform,
    setConfirmProvider,
    settings,
    type ConfirmProvider,
} from './services';
import { sidebar } from './sidebar';

export const offlineBanner = new OfflineBanner({
    top: () => getDesignInset().top,
    text: () => coreOptions.offlineBannerText,
});

export type SettingsProvider = () => void;
export type DocumentProvider = (kind: LegalDocument) => Promise<void> | void;

function defaultDocument(kind: LegalDocument) {
    const contract =
        kind === 'privacy' && platform.name === 'wechat'
            ? { text: coreText.wechatPrivacyGuide, onClick: () => void platform.openPrivacyContract() }
            : null;
    return openDocument(kind, { top: () => getDesignInset().top, extraAction: contract });
}

let documentProvider: DocumentProvider = defaultDocument;
const openLegal = (kind: LegalDocument) => Promise.resolve().then(() => documentProvider(kind));

function defaultSettings() {
    openSettings({
        title: coreOptions.settingsTitle,
        settings,
        openPrivacy: () => void openLegal('privacy'),
        openAgreement: () => void openLegal('agreement'),
    });
}

let settingsProvider: SettingsProvider = defaultSettings;

export const privacy = new PrivacyFlow({
    platform: () => platform,
    fallbackContract: () => void openLegal('privacy'),
    onDecision: (agree) => track('privacy_decision', { agree }),
});

export interface PrivacyPromptText {
    /** 平台后台填写的指引全称，如《xx小游戏隐私保护指引》 */
    guideName?: string;
    title?: string;
    content?: string;
}

export function createPrivacyPrompt(text: PrivacyPromptText = {}): PrivacyPrompt {
    const guide = text.guideName ?? '《隐私保护指引》';
    return ({ openContract }) =>
        confirm({
            title: text.title ?? coreText.privacyTitle,
            content: text.content ?? `使用相关功能前，请阅读并同意${guide}。拒绝后不影响基础玩法。`,
            confirmText: coreText.agree,
            cancelText: coreText.disagree,
            links: [{ text: `查看${guide}`, onClick: openContract }],
        });
}

export const defaultPrivacyPrompt: PrivacyPrompt = createPrivacyPrompt();

export const coreUi = {
    toast: (text: string) => oops.gui.toast(text),
    confirm,
    /** 替换模板内全部确认框的实现，例如改用业务 prefab */
    setConfirm: (provider: ConfirmProvider) => setConfirmProvider(provider),
    openSettings: () => settingsProvider(),
    /** 替换设置面板；自定义面板可读写 settings，并用 coreUi.openDocument 打开协议页 */
    setSettings: (provider: SettingsProvider) => {
        settingsProvider = provider;
    },
    openDocument: (kind: LegalDocument) => openLegal(kind),
    /** 替换隐私政策、用户协议页（含隐私流程中的查看入口） */
    setDocument: (provider: DocumentProvider) => {
        documentProvider = provider;
    },
    createSidebarEntry: (parent: Parameters<typeof createSidebarEntry>[0]) =>
        createSidebarEntry(parent, {
            isSupported: sidebar.isSupported,
            open: sidebar.open,
            confirm,
            text: coreOptions.sidebarEntry.text,
            rewardText: coreOptions.sidebarEntry.rewardText,
        }),
};
