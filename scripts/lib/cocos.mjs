import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const CREATOR_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).creator.version;

export const PLATFORMS = {
    web: 'web-mobile',
    wechat: 'wechatgame',
    douyin: 'bytedance-mini-game',
};

export const APPIDS = {
    wechat: { env: 'WECHAT_APPID', placeholder: 'touristappid' },
    douyin: { env: 'DOUYIN_APPID', placeholder: 'testappId' },
};

export const EXIT_SUCCESS = 36;

const ERROR_LINE = / - error: /;

const DEFAULT_CREATOR = {
    darwin: `/Applications/Cocos/Creator/${CREATOR_VERSION}/CocosCreator.app`,
    win32: `C:/ProgramData/cocos/editors/Creator/${CREATOR_VERSION}/CocosCreator.exe`,
};

export function creatorApp() {
    const app = process.env.COCOS_CREATOR_APP?.trim() || DEFAULT_CREATOR[process.platform];
    if (!app) {
        throw new Error('请设置 COCOS_CREATOR_APP：macOS 指向 CocosCreator.app，Windows 指向 CocosCreator.exe');
    }
    return app;
}

function isMacApp(app) {
    return app.endsWith('.app');
}

function isFile(path) {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

export function creatorExecutable() {
    const app = creatorApp();
    const exe = isMacApp(app) ? join(app, 'Contents/MacOS/CocosCreator') : app;
    if (!isFile(exe)) {
        throw new Error(
            `未找到 Cocos Creator ${CREATOR_VERSION} 可执行文件：${exe}（COCOS_CREATOR_APP：macOS 指向 .app，Windows 指向 CocosCreator.exe）`,
        );
    }
    return exe;
}

export function engineConfigPath() {
    const app = creatorApp();
    return isMacApp(app)
        ? join(app, 'Contents/Resources/resources/3d/engine/cc.config.json')
        : join(dirname(app), 'resources/resources/3d/engine/cc.config.json');
}

export function findErrorLines(log) {
    return log.split('\n').filter((line) => ERROR_LINE.test(line));
}

export function judgeBuild(exitCode, log) {
    const errors = findErrorLines(log);
    return { ok: exitCode === EXIT_SUCCESS && errors.length === 0, exitCode, errors };
}

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/** 收到中断信号时执行 cleanup，再以对应的信号退出码退出；返回取消监听的函数 */
export function onInterrupt(cleanup) {
    const handler = async (signal) => {
        await cleanup(signal);
        process.exit(SIGNAL_EXIT_CODES[signal]);
    };
    const signals = Object.keys(SIGNAL_EXIT_CODES);
    for (const signal of signals) process.once(signal, handler);
    return () => {
        for (const signal of signals) process.off(signal, handler);
    };
}

export function loadLocalEnv(file = join(ROOT, '.env.local')) {
    if (existsSync(file)) process.loadEnvFile(file);
}

export function resolveBuildConfig(platform, env = process.env) {
    const target = PLATFORMS[platform];
    if (!target) throw new Error(`未知平台：${platform}，可选 ${Object.keys(PLATFORMS).join(' / ')}`);
    const file = join(ROOT, 'build-configs', `${platform}.json`);
    const config = isFile(file) ? JSON.parse(readFileSync(file, 'utf8')) : { platform: target };
    const server = env.REMOTE_SERVER?.trim();
    if (server) config.server = server;
    const appid = APPIDS[platform];
    if (!appid) return { config, placeholder: false };
    const value = env[appid.env]?.trim();
    config.packages = {
        ...config.packages,
        [target]: { ...config.packages?.[target], appid: value || appid.placeholder },
    };
    return { config, placeholder: !value };
}

export const GAME_CONFIG = join(ROOT, 'assets', 'resources', 'config.json');

const ENV_BACKUP = join(ROOT, 'temp', 'build-env', 'config.json');

/** 上次构建被强制结束、没有还原 config.json 时，用备份还原；返回是否还原 */
export async function recoverGameEnv(file = GAME_CONFIG, backup = ENV_BACKUP) {
    if (!existsSync(backup)) return false;
    await writeFile(file, await readFile(backup, 'utf8'));
    await rm(backup, { force: true });
    return true;
}

/** 把 config.json 的环境切到 type，返回只执行一次的还原函数；type 为 null 或与当前相同时不改 */
export async function useGameEnv(type, file = GAME_CONFIG, backup = ENV_BACKUP) {
    if (type === null || type === undefined) return async () => {};
    const original = await readFile(file, 'utf8');
    const config = JSON.parse(original);
    if (!config.config?.[type]) throw new Error(`config.json 没有环境 ${type}`);
    if (config.type === type) return async () => {};
    await mkdir(dirname(backup), { recursive: true });
    await writeFile(backup, original);
    await writeFile(file, `${JSON.stringify({ ...config, type }, null, 2)}\n`);
    let restoring = null;
    return () => {
        restoring ??= writeFile(file, original).then(() => rm(backup, { force: true }));
        return restoring;
    };
}

/**
 * env 缺省时发布构建使用 prod，调试构建使用 config.json 当前环境
 * @param {string} platform
 * @param {{ debug?: boolean, allowPlaceholderAppid?: boolean, logFile: string, env?: string }} options
 */
export async function runBuild(platform, { debug = false, allowPlaceholderAppid = false, logFile, env }) {
    const target = PLATFORMS[platform];
    const { config, placeholder } = resolveBuildConfig(platform);
    if (placeholder) {
        const message = `${platform} 未设置 ${APPIDS[platform].env}，AppID 为占位值 ${APPIDS[platform].placeholder}`;
        if (!debug && !allowPlaceholderAppid) {
            throw new Error(`${message}；发布构建需设置真实 AppID，或加 --allow-placeholder-appid`);
        }
        console.warn(`! ${message}`);
    }
    const configPath = join(ROOT, 'temp', 'build-configs', `${platform}.json`);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const options = [`platform=${target}`, `debug=${debug}`, `configPath=${configPath}`];
    if (await recoverGameEnv()) console.warn('! 上次构建未还原 config.json，已从备份还原');
    const restore = await useGameEnv(env ?? (debug ? null : 'prod'));
    await mkdir(dirname(logFile), { recursive: true });
    const out = createWriteStream(logFile);
    let log = '';
    let child;
    const offInterrupt = onInterrupt(async (signal) => {
        child?.kill(signal);
        await restore();
    });
    let exitCode;
    try {
        exitCode = await new Promise((done, fail) => {
            child = spawn(creatorExecutable(), ['--project', ROOT, '--build', options.join(';')]);
            const collect = (chunk) => {
                log += chunk;
                out.write(chunk);
            };
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            child.on('error', fail);
            child.on('close', done);
        });
    } finally {
        offInterrupt();
        await new Promise((done) => out.end(done));
        await restore();
    }
    return { ...judgeBuild(exitCode, log), outputDir: join(ROOT, 'build', target) };
}
