import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { excludeRemoteForDouyin, prepareUpload, remoteCommand, uploadDouyin } from '../../scripts/lib/upload.mjs';

let dirs = [];

function project(
    platformDir,
    appid,
    { remote = false, debug = false, server = '', settings = 'settings.7b518.json' } = {},
) {
    const root = mkdtempSync(join(tmpdir(), 'upload-'));
    dirs.push(root);
    const dir = join(root, 'build', platformDir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'project.config.json'), JSON.stringify({ appid }));
    writeFileSync(join(dir, 'game.json'), '{}');
    if (settings) writeFileSync(join(dir, 'src', settings), JSON.stringify({ engine: { debug }, assets: { server } }));
    if (remote) mkdirSync(join(dir, 'remote'));
    const key = join(root, 'private.key');
    writeFileSync(key, 'key');
    return { root, key };
}

afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
});

const args = { version: '1.2.3', desc: 'test' };

describe('prepareUpload', () => {
    it('accepts a wechat build with matching appid and key file', () => {
        const { root, key } = project('wechatgame', 'wx123');
        const plan = prepareUpload('wechat', args, { WECHAT_APPID: 'wx123', WECHAT_UPLOAD_KEY: key }, root);
        expect(plan).toMatchObject({ appid: 'wx123', credential: key, version: '1.2.3', remote: null });
    });

    it('reports every missing argument and credential', () => {
        const { root } = project('wechatgame', 'wx123');
        expect(() => prepareUpload('wechat', {}, {}, root)).toThrow(
            /--version 必填[\s\S]*--desc 必填[\s\S]*未设置 WECHAT_APPID[\s\S]*未设置 WECHAT_UPLOAD_KEY/,
        );
    });

    it('rejects placeholder or mismatched build appids', () => {
        const placeholder = project('bytedance-mini-game', 'testappId');
        expect(() =>
            prepareUpload('douyin', args, { DOUYIN_APPID: 'tt1', DOUYIN_UPLOAD_TOKEN: 't' }, placeholder.root),
        ).toThrow('占位 AppID');
        const mismatch = project('bytedance-mini-game', 'tt2');
        expect(() =>
            prepareUpload('douyin', args, { DOUYIN_APPID: 'tt1', DOUYIN_UPLOAD_TOKEN: 't' }, mismatch.root),
        ).toThrow('不一致');
    });

    it('requires a CDN command and server address when the build has remote assets', () => {
        const env = { DOUYIN_APPID: 'tt1', DOUYIN_UPLOAD_TOKEN: 't' };
        const noServer = project('bytedance-mini-game', 'tt1', { remote: true });
        expect(() => prepareUpload('douyin', args, env, noServer.root)).toThrow(
            /REMOTE_UPLOAD_COMMAND[\s\S]*REMOTE_SERVER/,
        );
        const { root } = project('bytedance-mini-game', 'tt1', { remote: true, server: 'https://cdn.test/' });
        expect(
            prepareUpload('douyin', args, { ...env, REMOTE_UPLOAD_COMMAND: 'cp -r {dir} /cdn' }, root).remote,
        ).toMatchObject({
            command: 'cp -r {dir} /cdn',
        });
    });

    it('rejects unsupported platforms and missing builds', () => {
        expect(() => prepareUpload('web', args, {})).toThrow('不支持上传');
        const root = mkdtempSync(join(tmpdir(), 'upload-'));
        dirs.push(root);
        expect(() => prepareUpload('wechat', args, { WECHAT_APPID: 'wx1', WECHAT_UPLOAD_KEY: '/nope' }, root)).toThrow(
            /文件不存在[\s\S]*未找到构建产物/,
        );
    });
});

describe('upload safeguards', () => {
    const env = { DOUYIN_APPID: 'tt1', DOUYIN_UPLOAD_TOKEN: 'secret' };

    it('rejects debug builds and invalid robot numbers', () => {
        const { root } = project('bytedance-mini-game', 'tt1', { debug: true });
        expect(() => prepareUpload('douyin', { ...args, robot: 31 }, env, root)).toThrow(/--robot[\s\S]*调试包/);
        const plain = project('bytedance-mini-game', 'tt1', { debug: true, settings: 'settings.json' });
        expect(() => prepareUpload('douyin', args, env, plain.root)).toThrow('调试包');
    });

    it('rejects builds without a settings file', () => {
        const { root } = project('bytedance-mini-game', 'tt1', { settings: '' });
        expect(() => prepareUpload('douyin', args, env, root)).toThrow('缺少 src/settings');
    });

    it('rejects builds with several or unparsable settings files', () => {
        const { root } = project('bytedance-mini-game', 'tt1');
        const src = join(root, 'build', 'bytedance-mini-game', 'src');
        writeFileSync(join(src, 'settings.1a2b3.json'), '{}');
        expect(() => prepareUpload('douyin', args, env, root)).toThrow('多个 settings 文件');
        const broken = project('bytedance-mini-game', 'tt1', { settings: '' });
        writeFileSync(join(broken.root, 'build', 'bytedance-mini-game', 'src', 'settings.abc12.json'), '');
        expect(() => prepareUpload('douyin', args, env, broken.root)).toThrow('settings.abc12.json 无法解析');
    });

    it('excludes remote assets from the douyin package once', () => {
        const { root } = project('bytedance-mini-game', 'tt1');
        const dir = join(root, 'build', 'bytedance-mini-game');
        excludeRemoteForDouyin(dir);
        excludeRemoteForDouyin(dir);
        const config = JSON.parse(readFileSync(join(dir, 'project.config.json'), 'utf8'));
        expect(config.packOptions.ignore).toEqual([{ type: 'folder', value: 'remote' }]);
        expect(config.appid).toBe('tt1');
    });

    it('passes appid and token to tt-ide-cli in a temporary home that is removed afterwards', async () => {
        const { root } = project('bytedance-mini-game', 'tt1');
        const plan = prepareUpload('douyin', args, env, root);
        let home;
        const tma = {
            setAppConfig: vi.fn(() => {
                home = process.env.TMA_CLI_HOME;
            }),
            upload: vi.fn(() => Promise.resolve({ shortUrl: 'u' })),
        };
        const before = process.env.TMA_CLI_HOME;
        await expect(uploadDouyin(plan, () => Promise.resolve({ default: tma }))).resolves.toEqual({ shortUrl: 'u' });
        expect(tma.setAppConfig).toHaveBeenCalledWith({ appid: 'tt1', config: { token: 'secret' } });
        expect(tma.upload.mock.calls[0][0]).toMatchObject({
            version: '1.2.3',
            changeLog: 'test',
            project: { path: plan.projectPath },
        });
        expect(home).toBeTruthy();
        expect(existsSync(home)).toBe(false);
        expect(process.env.TMA_CLI_HOME).toBe(before);
    });

    it('removes its interrupt handlers after the upload', async () => {
        const { root } = project('bytedance-mini-game', 'tt1');
        const plan = prepareUpload('douyin', args, env, root);
        const before = process.listenerCount('SIGINT');
        const tma = { setAppConfig: vi.fn(), upload: vi.fn(() => Promise.reject(new Error('net'))) };
        await expect(uploadDouyin(plan, () => Promise.resolve({ default: tma }))).rejects.toThrow('net');
        expect(process.listenerCount('SIGINT')).toBe(before);
    });
});

describe('remoteCommand', () => {
    it('references the remote directory through an environment variable in every quoting context', () => {
        expect(remoteCommand('cp -r {dir} /cdn', 'darwin')).toBe('cp -r "${REMOTE_DIR}" /cdn');
        expect(remoteCommand('cp -r "{dir}" /cdn', 'linux')).toBe('cp -r "${REMOTE_DIR}" /cdn');
        expect(remoteCommand('rsync -a "{dir}/" host:/cdn', 'linux')).toBe('rsync -a "${REMOTE_DIR}/" host:/cdn');
        expect(remoteCommand("cp -r '{dir}/' /cdn", 'linux')).toBe(`cp -r ''"\${REMOTE_DIR}"'/' /cdn`);
        expect(remoteCommand('xcopy {dir} D:\\cdn', 'win32')).toBe('xcopy "%REMOTE_DIR%" D:\\cdn');
        expect(remoteCommand('xcopy "{dir}\\" D:\\cdn', 'win32')).toBe('xcopy "%REMOTE_DIR%\\" D:\\cdn');
    });

    it.skipIf(process.platform === 'win32')('passes paths with shell metacharacters unchanged', () => {
        const dir = '/tmp/a b/$HOME/`id`';
        const result = spawnSync(remoteCommand(`printf '%s|%s|%s' {dir} "{dir}/" '{dir}'`), {
            shell: true,
            env: { ...process.env, REMOTE_DIR: dir },
            encoding: 'utf8',
        });
        expect(result.stdout).toBe(`${dir}|${dir}/|${dir}`);
    });
});
