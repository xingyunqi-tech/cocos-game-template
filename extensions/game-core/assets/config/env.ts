import { oops } from 'db://oops-framework/core/Oops';
import type { IConfigEnvironment } from 'db://oops-framework/module/config/GameConfig';

declare module 'db://oops-framework/module/config/GameConfig' {
    interface IConfigEnvironment {
        httpServer: string;
        httpTimeout: number;
    }
}

export function getEnv(): IConfigEnvironment {
    return oops.config.game.data;
}
