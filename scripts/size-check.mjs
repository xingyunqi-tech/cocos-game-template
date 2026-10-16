import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PLATFORMS, ROOT } from './lib/cocos.mjs';
import { formatBytes, sizeReport } from './lib/size.mjs';

const LIMITS = JSON.parse(readFileSync(join(ROOT, 'scripts', 'size-limits.json'), 'utf8'));

export function checkPlatformSize(platform, dir = join(ROOT, 'build', PLATFORMS[platform])) {
    const limits = LIMITS[platform];
    if (!limits) return { ok: true, lines: [] };
    if (!existsSync(join(dir, 'game.json'))) {
        return { ok: false, lines: [`✗ 未找到 ${platform} 构建产物 ${dir}，先执行 npm run build:${platform}`] };
    }
    const { lines, violations } = sizeReport(platform, dir, limits);
    for (const v of violations) lines.push(`✗ ${v.label} ${formatBytes(v.bytes)} 超过上限 ${formatBytes(v.limit)}`);
    return { ok: violations.length === 0, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { positionals } = parseArgs({ allowPositionals: true });
    const platforms = positionals.length > 0 ? positionals : Object.keys(LIMITS);
    let failed = false;
    for (const platform of platforms) {
        const result = checkPlatformSize(platform);
        for (const line of result.lines) console.log(line);
        if (!result.ok) failed = true;
    }
    process.exit(failed ? 1 : 0);
}
