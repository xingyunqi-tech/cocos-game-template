/**
 * 业务类型扩展点，用 declare module 'db://game-core/augment' 扩展：
 * TableMap 由 npm run tables 生成的 TableTypes.ts 扩展；RemoteSettingsMap 由业务扩展，并用 remoteConfig.setDefaults 提供默认值
 */

export interface TableMap {
    readonly __tables?: never;
}

export interface RemoteSettingsMap {
    /** 审核模式，模板不读取，供业务在审核期间隐藏功能 */
    reviewMode: boolean;
    /** 分享奖励开关，模板不读取，供业务使用 */
    shareReward: boolean;
}
