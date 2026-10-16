import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadLocalEnv, PLATFORMS, ROOT, runBuild } from './lib/cocos.mjs';
import { checkPlatformSize } from './size-check.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        debug: { type: 'boolean', default: false },
        'allow-placeholder-appid': { type: 'boolean', default: false },
    },
});

loadLocalEnv();

const platforms = positionals.length > 0 ? positionals : Object.keys(PLATFORMS);
let failed = false;

for (const platform of platforms) {
    const logFile = join(ROOT, 'temp', 'build-logs', `${platform}.log`);
    let result;
    try {
        result = await runBuild(platform, {
            debug: values.debug,
            allowPlaceholderAppid: values['allow-placeholder-appid'],
            logFile,
        });
    } catch (err) {
        failed = true;
        console.error(`✗ ${platform} ${err.message}`);
        continue;
    }
    if (result.ok) {
        let size;
        try {
            size = checkPlatformSize(platform, result.outputDir);
        } catch (err) {
            size = { ok: false, lines: [`包体检查出错：${err.message}`] };
        }
        for (const line of size.lines) console.log(`  ${line}`);
        if (!size.ok && values.debug) console.warn(`! ${platform} 调试包超出包体上限，发布构建会失败`);
        else if (!size.ok) {
            failed = true;
            console.error(`✗ ${platform} 包体超限`);
            continue;
        }
        console.log(`✓ ${platform} → ${result.outputDir}`);
        continue;
    }
    failed = true;
    console.error(`✗ ${platform} 退出码 ${result.exitCode}，error ${result.errors.length} 行，日志 ${logFile}`);
    for (const line of result.errors.slice(0, 20)) console.error(`  ${line.slice(0, 240)}`);
}

process.exit(failed ? 1 : 0);
