import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPlatformSize } from '../size-check.mjs';
import { APPIDS, onInterrupt, PLATFORMS, ROOT } from './cocos.mjs';

export const UPLOAD_ENV = {
    wechat: { credential: 'WECHAT_UPLOAD_KEY', hint: '小程序后台下载的代码上传密钥文件路径' },
    douyin: { credential: 'DOUYIN_UPLOAD_TOKEN', hint: '抖音开发者后台生成的上传 token' },
};

const VERSION = /^\d+\.\d+\.\d+$/;
const SETTINGS_FILE = /^settings(\.[0-9a-f]+)?\.json$/;

function readSettings(projectPath, errors) {
    const dir = join(projectPath, 'src');
    const names = existsSync(dir) ? readdirSync(dir).filter((file) => SETTINGS_FILE.test(file)) : [];
    if (names.length === 0) {
        errors.push('构建产物缺少 src/settings*.json，请重新构建');
        return null;
    }
    if (names.length > 1) {
        errors.push(`构建产物 src/ 下有多个 settings 文件（${names.join('、')}），请清理后重新构建`);
        return null;
    }
    try {
        return JSON.parse(readFileSync(join(dir, names[0]), 'utf8'));
    } catch {
        errors.push(`构建产物 src/${names[0]} 无法解析，请重新构建`);
        return null;
    }
}

export function prepareUpload(platform, { version, desc, robot = 1 }, env = process.env, root = ROOT) {
    const target = PLATFORMS[platform];
    const upload = UPLOAD_ENV[platform];
    if (!upload) throw new Error(`不支持上传的平台：${platform}，可选 ${Object.keys(UPLOAD_ENV).join(' / ')}`);
    const errors = [];
    if (!version || !VERSION.test(version)) errors.push('--version 必填，格式为 x.y.z');
    if (!desc) errors.push('--desc 必填');
    if (!Number.isInteger(robot) || robot < 1 || robot > 30) errors.push('--robot 须为 1 到 30 的整数');
    const appid = env[APPIDS[platform].env]?.trim();
    if (!appid) errors.push(`未设置 ${APPIDS[platform].env}`);
    const credential = env[upload.credential]?.trim();
    if (!credential) errors.push(`未设置 ${upload.credential}（${upload.hint}）`);
    else if (platform === 'wechat' && !existsSync(credential)) errors.push(`${upload.credential} 指向的文件不存在`);

    const projectPath = join(root, 'build', target);
    const configFile = join(projectPath, 'project.config.json');
    if (!existsSync(configFile)) {
        errors.push(`未找到构建产物 ${projectPath}，先执行 npm run build:${platform}`);
    } else {
        const built = JSON.parse(readFileSync(configFile, 'utf8')).appid;
        if (built === APPIDS[platform].placeholder)
            errors.push(`构建产物使用占位 AppID ${built}，请设置 ${APPIDS[platform].env} 后重新构建`);
        else if (appid && built !== appid)
            errors.push(`构建产物 AppID ${built} 与 ${APPIDS[platform].env}=${appid} 不一致，请重新构建`);
    }
    const settings = existsSync(projectPath) ? readSettings(projectPath, errors) : null;
    if (settings?.engine?.debug) errors.push('构建产物是调试包，请去掉 --debug 重新构建');
    const remoteDir = join(projectPath, 'remote');
    const hasRemote = existsSync(remoteDir);
    if (hasRemote) {
        if (!env.REMOTE_UPLOAD_COMMAND) errors.push('构建产物包含 remote/，需设置 REMOTE_UPLOAD_COMMAND 上传到 CDN');
        if (!settings?.assets?.server) {
            errors.push('构建产物包含 remote/ 但未配置远程服务器地址，请设置 REMOTE_SERVER 后重新构建');
        }
    }
    if (existsSync(join(projectPath, 'game.json'))) {
        const size = checkPlatformSize(platform, projectPath);
        if (!size.ok) errors.push(`包体超限：\n${size.lines.join('\n')}`);
    }
    if (errors.length > 0) throw new Error(errors.join('\n'));
    return {
        platform,
        appid,
        credential,
        version,
        desc,
        robot,
        projectPath,
        remote: hasRemote ? { dir: remoteDir, command: env.REMOTE_UPLOAD_COMMAND } : null,
    };
}

export const REMOTE_IGNORE = 'remote/**/*';
export const REMOTE_DIR_ENV = 'REMOTE_DIR';

/** {dir} 替换为对环境变量 REMOTE_DIR 的引用，按所在引号补全引用方式，目录路径不经 shell 解析 */
export function remoteCommand(command, platform = process.platform) {
    const windows = platform === 'win32';
    const name = REMOTE_DIR_ENV;
    let quote = '';
    let out = '';
    for (let i = 0; i < command.length; i++) {
        if (command.startsWith('{dir}', i)) {
            if (windows) out += quote === '"' ? `%${name}%` : `"%${name}%"`;
            else if (quote === '"') out += `\${${name}}`;
            else if (quote === "'") out += `'"\${${name}}"'`;
            else out += `"\${${name}}"`;
            i += 4;
            continue;
        }
        const ch = command[i];
        if (quote === '' && (ch === '"' || (ch === "'" && !windows))) quote = ch;
        else if (ch === quote) quote = '';
        out += ch;
    }
    return out;
}

export async function uploadWechat(plan) {
    const { default: ci } = await import('miniprogram-ci');
    const project = new ci.Project({
        appid: plan.appid,
        type: 'miniGame',
        projectPath: plan.projectPath,
        privateKeyPath: plan.credential,
        ignores: ['node_modules/**/*', REMOTE_IGNORE],
    });
    const result = await ci.upload({
        project,
        version: plan.version,
        desc: plan.desc,
        robot: plan.robot,
        setting: { es6: false, minify: false },
        onProgressUpdate: (info) => console.log(typeof info === 'string' ? info : (info?.message ?? '')),
    });
    for (const pkg of result?.subPackageInfo ?? []) console.log(`  平台统计 ${pkg.name} ${pkg.size} 字节`);
    return result;
}

/** 抖音只认 project.config.json 的 packOptions.ignore，上传前写入以排除 remote/ */
export function excludeRemoteForDouyin(projectPath) {
    const file = join(projectPath, 'project.config.json');
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const ignore = config.packOptions?.ignore ?? [];
    if (!ignore.some((item) => item.type === 'folder' && item.value === 'remote')) {
        ignore.push({ type: 'folder', value: 'remote' });
    }
    config.packOptions = { ...config.packOptions, ignore };
    writeFileSync(file, JSON.stringify(config));
}

/** token 写入临时的 TMA_CLI_HOME，上传结束后删除 */
export async function uploadDouyin(plan, loadCli = () => import('tt-ide-cli')) {
    excludeRemoteForDouyin(plan.projectPath);
    const home = mkdtempSync(join(tmpdir(), 'tma-'));
    const previous = process.env.TMA_CLI_HOME;
    process.env.TMA_CLI_HOME = home;
    const offInterrupt = onInterrupt(() => rmSync(home, { recursive: true, force: true }));
    try {
        const { default: tma } = await loadCli();
        await tma.setAppConfig({ appid: plan.appid, config: { token: plan.credential } });
        return await tma.upload({
            project: { path: plan.projectPath },
            qrcode: { format: 'terminal', options: { small: true } },
            copyToClipboard: false,
            changeLog: plan.desc,
            version: plan.version,
            needUploadSourcemap: true,
        });
    } finally {
        if (previous === undefined) delete process.env.TMA_CLI_HOME;
        else process.env.TMA_CLI_HOME = previous;
        offInterrupt();
        rmSync(home, { recursive: true, force: true });
    }
}
