import { describe, expect, it } from 'vitest';
import { judgeBuild, resolveBuildConfig, runBuild } from '../../scripts/lib/cocos.mjs';

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
