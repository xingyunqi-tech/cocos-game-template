import { UserReady, type UserReadyListener } from '../boot/Lifecycle';
import { reportError } from '../monitor/errors';
import { createLogger } from '../monitor/logger';
import { track } from '../monitor/track';
import { AuthService } from '../net/AuthService';
import {
    bootPipeline,
    deviceSave,
    getDeviceId,
    http,
    LOGIN_STEP_TIMEOUT_MS,
    platform,
    serverTime,
    setSaveUser,
    userSave,
} from './services';
import { flushSidebarListeners } from './sidebar';

const log = createLogger('game-core');

const authSlot = deviceSave.slot('auth', { version: 1, defaults: () => ({ userId: '' }) });
const userReady = new UserReady((err) => reportError(err, 'manual', { from: 'onUserReady' }));

/** 登录步骤完成（含离线进入）或离线进入后重新联网登录成功时回调；注册时已就绪则立即回调；启动重试时可能再次回调 */
export function onUserReady(listener: UserReadyListener): () => void {
    return userReady.on(listener);
}

export const auth = new AuthService({
    http,
    platform: () => platform,
    deviceId: getDeviceId,
    lastUser: {
        get: () => authSlot.get().userId,
        set: (userId) => {
            if (authSlot.get().userId === userId) return;
            authSlot.set({ userId });
            deviceSave.flush();
        },
    },
    onUser: (userId) => {
        setSaveUser(userId);
        if (userId !== auth.guestId && userSave.adoptScope(auth.guestId)) log.info('游客存档已并入登录账号');
    },
    onWarn: (message, detail) => log.warn(message, detail),
    onServerTime: (serverMs, startedAt) => serverTime.sync(serverMs, startedAt),
    onRecovered: (userId) => userReady.emit({ userId, offline: false }),
    mark: () => serverTime.mark(),
});

export function registerLoginStep() {
    bootPipeline.register(
        'login',
        async ({ signal }) => {
            const outcome = await auth.login(signal);
            log.info(outcome.offline ? '离线进入' : '登录成功');
            log.debug('userId', outcome.userId);
            track('login', { offline: outcome.offline });
            flushSidebarListeners();
            userReady.emit({ userId: outcome.userId, offline: outcome.offline });
        },
        { timeoutMs: LOGIN_STEP_TIMEOUT_MS },
    );
}
