import type { LaunchOptions, NetworkType } from './types';

export const SIDEBAR_SCENES: readonly string[] = ['021036', '101036', '181036', '261036'];

export function isSidebarLaunch(options: LaunchOptions): boolean {
    if (options.launchFrom === 'homepage' && options.location === 'sidebar_card') return true;
    return SIDEBAR_SCENES.includes(options.scene);
}

export function compareVersion(a: string, b: string): number {
    const left = a.split('.');
    const right = b.split('.');
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        const diff = (parseInt(left[i] ?? '0', 10) || 0) - (parseInt(right[i] ?? '0', 10) || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

export interface RawLaunchOptions {
    scene?: number | string;
    query?: Record<string, unknown>;
    launch_from?: string;
    location?: string;
    referrerInfo?: { appId?: string; extraData?: unknown };
}

export function normalizeLaunchOptions(raw: RawLaunchOptions | null | undefined): LaunchOptions {
    const query: Record<string, string> = {};
    const source = raw?.query ?? {};
    for (const key of Object.keys(source)) {
        const value = source[key];
        if (value !== undefined && value !== null)
            query[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    const options: LaunchOptions = { scene: raw?.scene === undefined ? '' : String(raw.scene), query };
    if (raw?.launch_from) options.launchFrom = raw.launch_from;
    if (raw?.location) options.location = raw.location;
    if (raw?.referrerInfo) options.referrerInfo = raw.referrerInfo;
    return options;
}

export function parseQueryString(search: string): Record<string, string> {
    const query: Record<string, string> = {};
    for (const pair of search.replace(/^\?/, '').split('&')) {
        if (!pair) continue;
        const index = pair.indexOf('=');
        const key = index < 0 ? pair : pair.slice(0, index);
        const value = index < 0 ? '' : pair.slice(index + 1);
        try {
            query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
        } catch {
            query[key] = value;
        }
    }
    return query;
}

const NETWORK_TYPES: readonly NetworkType[] = ['wifi', '2g', '3g', '4g', '5g', 'unknown', 'none'];

export function toNetworkType(value: unknown): NetworkType {
    const text = typeof value === 'string' ? value.toLowerCase() : '';
    return (NETWORK_TYPES as readonly string[]).includes(text) ? (text as NetworkType) : 'unknown';
}

const UNIT_PROBE_MS = 2;
const UNIT_PROBE_MAX_SPINS = 1e7;
const MICROSECOND_RATIO = 30;

/** 把平台计时器换算为毫秒：单位因环境而异（毫秒或微秒），创建时对照墙钟约 2ms 判定；计时器不前进时返回 null */
export function steadyClock(read: () => number, wall: () => number = Date.now): (() => number) | null {
    const startRead = read();
    const startWall = wall();
    let elapsedWall = 0;
    for (let spins = 0; elapsedWall < UNIT_PROBE_MS && spins < UNIT_PROBE_MAX_SPINS; spins++) {
        elapsedWall = wall() - startWall;
    }
    const elapsedRead = read() - startRead;
    if (elapsedWall <= 0 || !(elapsedRead > 0)) return null;
    const scale = elapsedRead / elapsedWall > MICROSECOND_RATIO ? 1000 : 1;
    return () => read() / scale;
}

export function errorCodeOf(err: unknown): number | undefined {
    if (typeof err !== 'object' || err === null) return undefined;
    const record = err as { errCode?: unknown; errNo?: unknown };
    const code = record.errCode ?? record.errNo;
    return typeof code === 'number' ? code : undefined;
}
