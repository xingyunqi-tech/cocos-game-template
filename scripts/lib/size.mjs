import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXCLUDED = ['remote/'];

function walk(dir, base = dir, files = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, base, files);
        else files.push({ path: relative(base, full).split(sep).join('/'), bytes: stat.size });
    }
    return files;
}

function normalizeRoot(root) {
    return `${root.replace(/^\.?\/+/, '').replace(/\/+$/, '')}/`;
}

export function readSubpackages(dir) {
    const game = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8'));
    return (game.subpackages ?? game.subPackages ?? []).map((pkg) => ({
        name: pkg.name ?? pkg.root,
        root: normalizeRoot(pkg.root),
        independent: Boolean(pkg.independent),
    }));
}

export function measurePackage(dir) {
    const subpackages = readSubpackages(dir).map((pkg) => ({ ...pkg, bytes: 0 }));
    let main = 0;
    let excluded = 0;
    for (const file of walk(dir)) {
        if (EXCLUDED.some((prefix) => file.path.startsWith(prefix))) {
            excluded += file.bytes;
            continue;
        }
        const owner = subpackages.find((pkg) => file.path.startsWith(pkg.root));
        if (owner) owner.bytes += file.bytes;
        else main += file.bytes;
    }
    const total = main + subpackages.reduce((sum, pkg) => sum + pkg.bytes, 0);
    return { main, subpackages, total, excluded };
}

export function checkLimits(measure, limits) {
    const violations = [];
    const over = (label, bytes, limit) => {
        if (limit !== null && limit !== undefined && bytes > limit) violations.push({ label, bytes, limit });
    };
    over('主包', measure.main, limits.main);
    for (const pkg of measure.subpackages) {
        over(`分包 ${pkg.name}`, pkg.bytes, pkg.independent ? limits.independent : limits.subpackage);
    }
    over('总包', measure.total, limits.total);
    return violations;
}

export function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)}MB（${bytes.toLocaleString('en-US')} 字节）`;
}

export function sizeReport(platform, dir, limits) {
    const measure = measurePackage(dir);
    const lines = [`${platform} 主包 ${formatBytes(measure.main)}，总包 ${formatBytes(measure.total)}`];
    for (const pkg of measure.subpackages) lines.push(`  分包 ${pkg.name} ${formatBytes(pkg.bytes)}`);
    if (measure.excluded > 0) lines.push(`  remote ${formatBytes(measure.excluded)}（不计入包体）`);
    return { measure, lines, violations: checkLimits(measure, limits) };
}
