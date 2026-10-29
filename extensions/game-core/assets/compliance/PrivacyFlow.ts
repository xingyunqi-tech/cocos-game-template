import type { IPlatform } from '../platform/types';

export interface PrivacyPrompt {
    /** 展示自定义隐私弹窗，返回用户是否同意 */
    (actions: { openContract: () => void }): Promise<boolean>;
}

export interface PrivacyFlowOptions {
    platform: () => IPlatform;
    onDecision?: (agree: boolean) => void;
    /** 平台无法打开隐私指引时的替代页面 */
    fallbackContract?: () => void;
}

/** 默认由平台展示官方隐私弹窗；拒绝后调用隐私接口失败，基础玩法不受影响 */
export class PrivacyFlow {
    private prompt: PrivacyPrompt | null = null;
    private pending: Promise<boolean> | null = null;

    constructor(private readonly options: PrivacyFlowOptions) {}

    get custom(): boolean {
        return this.prompt !== null;
    }

    /** 改用自定义弹窗；平台或基础库不支持时返回 false 并继续使用官方弹窗 */
    useCustomPrompt(prompt: PrivacyPrompt): boolean {
        if (this.prompt) {
            this.prompt = prompt;
            return true;
        }
        const registered = this.options.platform().onNeedPrivacyAuthorization((resolve, exposed) => {
            void this.handle(resolve, exposed);
        });
        if (registered) this.prompt = prompt;
        return registered;
    }

    /** 主动触发隐私授权（如启动后、进入需要隐私接口的功能前）：需要授权时弹出隐私弹窗，返回是否已授权；平台没有该接口时返回 true */
    require(): Promise<boolean> {
        const platform = this.options.platform();
        if (!platform.requirePrivacyAuthorize) return Promise.resolve(true);
        return platform.requirePrivacyAuthorize().catch(() => false);
    }

    needAuthorization(): Promise<boolean> {
        return this.options
            .platform()
            .getPrivacySetting()
            .then(
                (setting) => setting.supported && setting.needAuthorization,
                () => false,
            );
    }

    private openContract() {
        void this.options
            .platform()
            .openPrivacyContract()
            .then(
                (opened) => opened || this.options.fallbackContract?.(),
                () => this.options.fallbackContract?.(),
            );
    }

    private async handle(resolve: (agree: boolean) => void, exposed: () => void) {
        const prompt = this.prompt;
        if (!prompt) {
            resolve(false);
            return;
        }
        this.pending ??= Promise.resolve()
            .then(() => {
                exposed();
                return prompt({ openContract: () => this.openContract() });
            })
            .finally(() => {
                this.pending = null;
            });
        let agree = false;
        try {
            agree = await this.pending;
        } catch {
            agree = false;
        }
        resolve(agree);
        this.options.onDecision?.(agree);
    }
}
