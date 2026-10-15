import { sys } from 'cc';
import { DEBUG, HTML5, MINIGAME } from 'cc/env';
import { EventMessage } from 'db://oops-framework/core/common/event/EventMessage';
import { oops } from 'db://oops-framework/core/Oops';
import { BootPipeline } from './boot/BootPipeline';
import { Lifecycle } from './boot/Lifecycle';
import { getEnv } from './config/env';
import { RemoteConfig } from './config/RemoteConfig';
import { errorReporter, installWebErrorHooks, reportError } from './monitor/errors';
import { createLogger, logHub } from './monitor/logger';
import { tracker } from './monitor/track';
import { HttpClient } from './net/HttpClient';
import { MockTransport } from './net/MockTransport';
import { XhrTransport } from './net/XhrTransport';
import type { KeyValueStore } from './save/KeyValueStore';
import { SaveStore } from './save/SaveStore';

export interface CoreRemoteSettings {
    reviewMode: boolean;
    shareReward: boolean;
}

const storage = () => sys.localStorage as KeyValueStore;
const localStore: KeyValueStore = {
    getItem: (key) => storage().getItem(key),
    setItem: (key, value) => storage().setItem(key, value),
    removeItem: (key) => storage().removeItem(key),
};

const log = createLogger('game-core');
const saveWarn = (message: string, detail: Record<string, unknown>) => log.warn(message, detail);

export const bootPipeline = new BootPipeline();
export const lifecycle = new Lifecycle();
export const xhrTransport = new XhrTransport();
export const mockTransport = new MockTransport();
export const http = new HttpClient({ transport: xhrTransport });
export const deviceSave = new SaveStore({ store: localStore, prefix: 'gc:d', onWarn: saveWarn });
export const userSave = new SaveStore({ store: localStore, prefix: 'gc:u', requireScope: true, onWarn: saveWarn });
export const remoteConfig = new RemoteConfig<CoreRemoteSettings>({ reviewMode: false, shareReward: false });

bootPipeline.register(
    'remote-config',
    async () => {
        const source = await remoteConfig.load();
        log.info('远程配置来源', source);
    },
    { optional: true, timeoutMs: 5000 },
);

let initialized = false;

export function initGameCore() {
    if (initialized) return;
    initialized = true;

    const env = getEnv();
    logHub.setLevel(env.logLevel ?? (DEBUG ? 'debug' : 'warn'));
    errorReporter.addSink((report) => log.error(`[${report.source}] ${report.message}`, report.context));
    if (HTML5 && !MINIGAME) installWebErrorHooks(window);
    const context = { version: env.version, platform: String(sys.platform) };
    errorReporter.setContext(context);
    tracker.setCommonParams(context);
    tracker.addSink(({ event, params }) => log.debug('track', event, params));

    http.configure({
        baseUrl: env.httpServer,
        timeoutMs: env.httpTimeout,
        transport: env.httpMock ? mockTransport : xhrTransport,
        onError: (error, request) => {
            if (error.kind === 'aborted') return;
            reportError(error, 'http', {
                method: request.method,
                url: request.url,
                kind: error.kind,
                status: error.status,
            });
        },
    });

    lifecycle.bind(oops.message, EventMessage.GAME_SHOW, EventMessage.GAME_HIDE);
    lifecycle.onHide(() => {
        deviceSave.flush();
        userSave.flush();
    });

    if (DEBUG && HTML5) {
        (window as unknown as Record<string, unknown>).gameCore = {
            bootPipeline,
            lifecycle,
            http,
            mockTransport,
            deviceSave,
            userSave,
            remoteConfig,
            HttpClient,
            XhrTransport,
        };
    }
}

export function setSaveUser(userId: string) {
    userSave.setScope(userId);
}
