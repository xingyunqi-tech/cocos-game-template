import { oops } from 'db://oops-framework/core/Oops';
import type { IConfigEnvironment } from 'db://oops-framework/module/config/GameConfig';

declare module 'db://oops-framework/module/config/GameConfig' {
    interface IConfigEnvironment {
        httpServer: string;
        httpTimeout: number;
        httpMock: boolean;
        logLevel: 'debug' | 'info' | 'warn' | 'error';
        loginFallback?: 'guest' | 'last-user';
        /** 远程配置接口路径，空表示只用本地默认值 */
        remoteConfigPath?: string;
        /** 埋点与错误上报接口路径，空表示只输出到日志 */
        trackPath?: string;
    }
}

export function getEnv(): IConfigEnvironment {
    return oops.config.game.data;
}
