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

interface GameConfigInternals {
    _data: { type: string; config: Record<string, unknown> };
}

/** config.json 的 type 与各环境配置（读取 oops GameConfig 的内部字段） */
export function gameConfigData(): { type: string; config: Record<string, unknown> } {
    return (oops.config.game as unknown as GameConfigInternals)._data;
}

/** config.json 的 type 没有对应环境配置时返回错误信息 */
export function configProblem(json: unknown): string | null {
    const data = json as { type?: unknown; config?: Record<string, unknown> } | null;
    const type = typeof data?.type === 'string' ? data.type : '';
    const env = data?.config && Object.prototype.hasOwnProperty.call(data.config, type) ? data.config[type] : null;
    if (env && typeof env === 'object' && !Array.isArray(env)) return null;
    return `config.json 的 type「${type}」没有对应的环境配置`;
}
