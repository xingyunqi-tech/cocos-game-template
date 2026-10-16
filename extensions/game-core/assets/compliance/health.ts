export const HEALTH_NOTICE = [
    '抵制不良游戏，拒绝盗版游戏。',
    '注意自我保护，谨防受骗上当。',
    '适度游戏益脑，沉迷游戏伤身。',
    '合理安排时间，享受健康生活。',
];

export interface AntiAddictionStatus {
    allowed: boolean;
    remainingMinutes?: number;
    message?: string;
}

/** 防沉迷：小游戏端由平台负责；Web 国内运营需业务接入实名与时长限制 */
export interface IAntiAddiction {
    check(): Promise<AntiAddictionStatus>;
}

export const platformManagedAntiAddiction: IAntiAddiction = {
    check: () => Promise.resolve({ allowed: true }),
};
