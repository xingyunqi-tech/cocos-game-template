import { oops } from 'db://oops-framework/core/Oops';
import type { IConfigEnvironment } from 'db://oops-framework/module/config/GameConfig';

declare module 'db://oops-framework/module/config/GameConfig' {
    interface IConfigEnvironment {
        httpServer: string;
        httpTimeout: number;
        httpMock: boolean;
        logLevel: 'debug' | 'info' | 'warn' | 'error';
        loginFallback?: 'guest' | 'last-user';
    }
}

export function getEnv(): IConfigEnvironment {
    return oops.config.game.data;
}
