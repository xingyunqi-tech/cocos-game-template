import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const CREATOR_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).creator.version;

export const PLATFORMS = {
    web: 'web-mobile',
    wechat: 'wechatgame',
    douyin: 'bytedance-mini-game',
};

export const EXIT_SUCCESS = 36;

const ERROR_LINE = / - error: /;

const DEFAULT_CREATOR = {
    darwin: `/Applications/Cocos/Creator/${CREATOR_VERSION}/CocosCreator.app`,
    win32: `C:/ProgramData/cocos/editors/Creator/${CREATOR_VERSION}/CocosCreator.exe`,
};

export function creatorApp() {
    const app = process.env.COCOS_CREATOR_APP ?? DEFAULT_CREATOR[process.platform];
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

export async function runBuild(platform, { debug = false, logFile } = {}) {
    const target = PLATFORMS[platform];
    if (!target) throw new Error(`未知平台：${platform}，可选 ${Object.keys(PLATFORMS).join(' / ')}`);
    const options = [`platform=${target}`, `debug=${debug}`];
    const configPath = join(ROOT, 'build-configs', `${platform}.json`);
    if (isFile(configPath)) options.push(`configPath=${configPath}`);
    await mkdir(dirname(logFile), { recursive: true });
    const out = createWriteStream(logFile);
    let log = '';
    const exitCode = await new Promise((done, fail) => {
        const child = spawn(creatorExecutable(), ['--project', ROOT, '--build', options.join(';')]);
        const collect = (chunk) => {
            log += chunk;
            out.write(chunk);
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', fail);
        child.on('close', done);
    });
    out.end();
    return { ...judgeBuild(exitCode, log), outputDir: join(ROOT, 'build', target) };
}
