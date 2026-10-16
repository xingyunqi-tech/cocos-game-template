import { THEME, addButton, addLabel, addPanel, getLayer, openModal, setButtonText } from './kit';
import type { Settings } from './Settings';

export interface SettingsPanelOptions {
    title: string;
    settings: Settings;
    openPrivacy: () => void;
    openAgreement: () => void;
}

type ToggleKey = 'music' | 'effect' | 'vibration';

const ROWS: Array<{ key: ToggleKey; label: string }> = [
    { key: 'music', label: '音乐' },
    { key: 'effect', label: '音效' },
    { key: 'vibration', label: '震动' },
];

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

    ROWS.forEach((row, index) => {
        const y = HEIGHT / 2 - 160 - index * 100;
        addLabel(panel, row.label, { width: 200, align: 'left' }).node.setPosition(-WIDTH / 2 + 150, y);
        const render = () =>
            setButtonText(toggle, settings[row.key] ? '开' : '关', settings[row.key] ? THEME.primary : THEME.secondary);
        const toggle = addButton(
            panel,
            settings[row.key] ? '开' : '关',
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
    addButton(panel, '隐私政策', options.openPrivacy, linkStyle).setPosition(-130, -HEIGHT / 2 + 170);
    addButton(panel, '用户协议', options.openAgreement, linkStyle).setPosition(130, -HEIGHT / 2 + 170);
    addButton(panel, '关闭', () => modal.close()).setPosition(0, -HEIGHT / 2 + 70);
    return modal;
}
