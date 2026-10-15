import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PLATFORMS, ROOT, runBuild } from './lib/cocos.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { debug: { type: 'boolean', default: false } },
});

const platforms = positionals.length > 0 ? positionals : Object.keys(PLATFORMS);
let failed = false;

for (const platform of platforms) {
    const logFile = join(ROOT, 'temp', 'build-logs', `${platform}.log`);
    const result = await runBuild(platform, { debug: values.debug, logFile });
    if (result.ok) {
        console.log(`✓ ${platform} → ${result.outputDir}`);
        continue;
    }
    failed = true;
    console.error(`✗ ${platform} 退出码 ${result.exitCode}，error ${result.errors.length} 行，日志 ${logFile}`);
    for (const line of result.errors.slice(0, 20)) console.error(`  ${line.slice(0, 240)}`);
}

process.exit(failed ? 1 : 0);
