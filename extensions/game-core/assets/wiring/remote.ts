import { getEnv } from '../config/env';
import type { RemoteSettingsMap } from '../config/RemoteConfig';
import { createLogger } from '../monitor/logger';
import { bootPipeline, deviceSave, http, platform, remoteConfig } from './services';

const log = createLogger('game-core');

interface RemoteCache {
    key: string;
    values: Partial<RemoteSettingsMap>;
}

const remoteCache = deviceSave.slot<RemoteCache | null>('remote-config', { version: 2, defaults: () => null });

function remoteCacheKey(): string {
    const env = getEnv();
    return `${platform.name}|${platform.getEnvVersion()}|${env.version}|${env.httpServer}`;
}

function cachedRemoteConfig(): Partial<RemoteSettingsMap> | null {
    const cached = remoteCache.get();
    return cached && cached.key === remoteCacheKey() ? cached.values : null;
}

/** 远程配置：按 platform、version、envVersion 拉取，成功后缓存 */
export function fetchRemoteConfig(path: string): Promise<Partial<RemoteSettingsMap>> {
    const env = getEnv();
    return http
        .get<Partial<RemoteSettingsMap>>(
            path,
            {
                platform: platform.name,
                version: env.version,
                envVersion: platform.getEnvVersion(),
            },
            { timeoutMs: 2500, retries: 0 },
        )
        .then((res) => {
            const values = res.data && typeof res.data === 'object' ? res.data : {};
            remoteCache.set({ key: remoteCacheKey(), values });
            return values;
        });
}

export function registerRemoteConfigStep() {
    bootPipeline.register(
        'remote-config',
        async () => {
            const path = getEnv().remoteConfigPath;
            const source = await remoteConfig.load(
                path ? () => fetchRemoteConfig(path) : undefined,
                3000,
                cachedRemoteConfig,
            );
            log.info('远程配置来源', source);
        },
        { optional: true, timeoutMs: 5000 },
    );
}
