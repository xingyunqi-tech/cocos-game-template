import { LEGAL_DOCUMENTS } from './DocumentPage';
import { THEME, addButton, addLabel, addPanel, getLayer, openModal, setButtonText } from './kit';
import type { Settings } from './Settings';
import { coreText } from './strings';

export interface SettingsPanelOptions {
    title: string;
    settings: Settings;
    openPrivacy: () => void;
    openAgreement: () => void;
}

type ToggleKey = 'music' | 'effect' | 'vibration';

const ROWS: ToggleKey[] = ['music', 'effect', 'vibration'];

const WIDTH = 580;
const HEIGHT = 680;

export function openSettings(options: SettingsPanelOptions) {
    if (getLayer('LayerDialog')?.getChildByName('SettingsPanel')) return null;
    const modal = openModal('LayerDialog', 'SettingsPanel');
    if (!modal) return null;
    const { settings } = options;
    const panel = addPanel(modal.root, WIDTH, HEIGHT);
    addLabel(panel, options.title, { fontSize: THEME.titleSize, width: WIDTH - 60 }).node.setPosition(
        0,
        HEIGHT / 2 - 60,
    );

    ROWS.forEach((key, index) => {
        const row = { key, label: coreText[key] };
        const y = HEIGHT / 2 - 160 - index * 100;
        addLabel(panel, row.label, { width: 200, align: 'left' }).node.setPosition(-WIDTH / 2 + 150, y);
        const render = () =>
            setButtonText(
                toggle,
                settings[row.key] ? coreText.on : coreText.off,
                settings[row.key] ? THEME.primary : THEME.secondary,
            );
        const toggle = addButton(
            panel,
            settings[row.key] ? coreText.on : coreText.off,
            () => {
                settings[row.key] = !settings[row.key];
                render();
                if (row.key === 'vibration') settings.vibrate('short');
            },
            { width: 140, height: 64 },
        );
        toggle.name = `Toggle_${row.key}`;
        toggle.setPosition(WIDTH / 2 - 120, y);
        render();
    });

    const linkStyle = { width: 240, height: 56, color: THEME.panel, textColor: THEME.primary, fontSize: 26 };
    addButton(panel, LEGAL_DOCUMENTS.privacy.title, options.openPrivacy, linkStyle).setPosition(
        -130,
        -HEIGHT / 2 + 170,
    );
    addButton(panel, LEGAL_DOCUMENTS.agreement.title, options.openAgreement, linkStyle).setPosition(
        130,
        -HEIGHT / 2 + 170,
    );
    addButton(panel, coreText.close, () => modal.close()).setPosition(0, -HEIGHT / 2 + 70);
    return modal;
}
