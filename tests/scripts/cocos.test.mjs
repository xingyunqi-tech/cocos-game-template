import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    creatorApp,
    judgeBuild,
    recoverGameEnv,
    resolveBuildConfig,
    runBuild,
    useGameEnv,
} from '../../scripts/lib/cocos.mjs';

const NOISE = [
    '10-15-2026 03:32:25 - debug: Error: Exit process with code:null, signal:SIGTERM in task build-script',
    '[1015/033225.000:ERROR:mach_port_rendezvous.cc(384)] bootstrap_look_up failed',
].join('\n');

describe('judgeBuild', () => {
    it('passes exit code 36 without error lines', () => {
        expect(judgeBuild(36, NOISE)).toMatchObject({ ok: true, errors: [] });
    });

    it('fails exit code 36 with asset error lines', () => {
        const log = `${NOISE}\n10-15-2026 03:35:37 - error: Script "x" attached to "root" in scene "main" is missing or invalid.`;
        const result = judgeBuild(36, log);
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
    });

    it('fails non-36 exit codes', () => {
        expect(judgeBuild(34, NOISE).ok).toBe(false);
        expect(judgeBuild(32, '').ok).toBe(false);
    });
});

describe('creatorApp', () => {
    it('uses the default install path when COCOS_CREATOR_APP is empty', () => {
        const saved = process.env.COCOS_CREATOR_APP;
        try {
            delete process.env.COCOS_CREATOR_APP;
            const fallback = process.platform in { darwin: 1, win32: 1 } ? creatorApp() : null;
            process.env.COCOS_CREATOR_APP = ' ';
            if (fallback) expect(creatorApp()).toBe(fallback);
            else expect(() => creatorApp()).toThrow('COCOS_CREATOR_APP');
        } finally {
            if (saved === undefined) delete process.env.COCOS_CREATOR_APP;
            else process.env.COCOS_CREATOR_APP = saved;
        }
    });
});

describe('resolveBuildConfig', () => {
    it('keeps the web config without an appid', () => {
        const { config, placeholder } = resolveBuildConfig('web', {});
        expect(config.platform).toBe('web-mobile');
        expect(config.packages['web-mobile'].appid).toBeUndefined();
        expect(placeholder).toBe(false);
    });

    it('injects appids from the environment', () => {
        const { config, placeholder } = resolveBuildConfig('wechat', { WECHAT_APPID: ' wx123 ' });
        expect(config.packages.wechatgame.appid).toBe('wx123');
        expect(placeholder).toBe(false);
    });

    it('falls back to placeholder appids', () => {
        expect(resolveBuildConfig('wechat', {})).toMatchObject({
            config: { packages: { wechatgame: { appid: 'touristappid' } } },
            placeholder: true,
        });
        expect(resolveBuildConfig('douyin', { DOUYIN_APPID: '' }).config.packages['bytedance-mini-game'].appid).toBe(
            'testappId',
        );
    });

    it('injects the remote server address when set', () => {
        expect(resolveBuildConfig('douyin', { REMOTE_SERVER: 'https://cdn.example.com/game/' }).config.server).toBe(
            'https://cdn.example.com/game/',
        );
        expect(resolveBuildConfig('douyin', {}).config.server).toBeUndefined();
    });

    it('rejects unknown platforms', () => {
        expect(() => resolveBuildConfig('alipay', {})).toThrow('未知平台');
    });
});

describe('runBuild', () => {
    it('refuses release builds with placeholder appids', async () => {
        const saved = process.env.DOUYIN_APPID;
        process.env.DOUYIN_APPID = '';
        try {
            await expect(runBuild('douyin', { debug: false, logFile: 'unused.log' })).rejects.toThrow(
                '--allow-placeholder-appid',
            );
        } finally {
            if (saved === undefined) delete process.env.DOUYIN_APPID;
            else process.env.DOUYIN_APPID = saved;
        }
    });
});

describe('useGameEnv', () => {
    const original = '{\n  "gui": [{ "type": "Game" }],\n  "type": "dev",\n  "config": { "dev": {}, "prod": {} }\n}\n';
    const files = () => {
        const dir = mkdtempSync(join(tmpdir(), 'game-env-'));
        const path = join(dir, 'config.json');
        writeFileSync(path, original);
        return { path, backup: join(dir, 'backup', 'config.json') };
    };

    it('switches only the top-level environment and restores the original text once', async () => {
        const { path, backup } = files();
        const restore = await useGameEnv('prod', path, backup);
        const switched = JSON.parse(readFileSync(path, 'utf8'));
        expect(switched.type).toBe('prod');
        expect(switched.gui[0].type).toBe('Game');
        expect(readFileSync(backup, 'utf8')).toBe(original);
        await Promise.all([restore(), restore()]);
        expect(readFileSync(path, 'utf8')).toBe(original);
        expect(existsSync(backup)).toBe(false);
    });

    it('leaves the file untouched without a type or with the current type', async () => {
        const { path, backup } = files();
        await (
            await useGameEnv(null, path, backup)
        )();
        await (
            await useGameEnv('dev', path, backup)
        )();
        expect(readFileSync(path, 'utf8')).toBe(original);
    });

    it('rejects an environment missing from the config', async () => {
        const { path, backup } = files();
        await expect(useGameEnv('test', path, backup)).rejects.toThrow('config.json 没有环境 test');
        await expect(useGameEnv('', path, backup)).rejects.toThrow('config.json 没有环境 ');
    });

    it('recovers the original config left switched by a killed build', async () => {
        const { path, backup } = files();
        await useGameEnv('prod', path, backup);
        await expect(recoverGameEnv(path, backup)).resolves.toBe(true);
        expect(readFileSync(path, 'utf8')).toBe(original);
        await expect(recoverGameEnv(path, backup)).resolves.toBe(false);
    });
});
