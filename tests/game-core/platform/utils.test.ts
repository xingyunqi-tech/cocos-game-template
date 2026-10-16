import { describe, expect, it } from 'vitest';
import {
    compareVersion,
    errorCodeOf,
    isSidebarLaunch,
    normalizeLaunchOptions,
    parseQueryString,
    steadyClock,
    toNetworkType,
} from 'db://game-core/platform/utils';

describe('steadyClock', () => {
    function ticking(ratio: number) {
        const c = { wall: 0 };
        const wall = () => ++c.wall;
        const read = () => c.wall * ratio + 5000;
        return { c, clock: steadyClock(read, wall) };
    }

    it('converts a microsecond timer to milliseconds', () => {
        const { c, clock } = ticking(1000);
        const first = clock!();
        c.wall += 100;
        expect(clock!() - first).toBe(100);
    });

    it('keeps a millisecond timer as is', () => {
        const { c, clock } = ticking(1);
        const first = clock!();
        c.wall += 100;
        expect(clock!() - first).toBe(100);
    });

    it('returns null when the timer does not advance', () => {
        let wall = 0;
        expect(
            steadyClock(
                () => 42,
                () => ++wall,
            ),
        ).toBeNull();
    });
});

describe('compareVersion', () => {
    it('compares dotted versions numerically', () => {
        expect(compareVersion('4.17.0', '4.9.9')).toBe(1);
        expect(compareVersion('4.17', '4.17.0')).toBe(0);
        expect(compareVersion('2.32.2', '2.32.3')).toBe(-1);
        expect(compareVersion('', '1.0.0')).toBe(-1);
    });
});

describe('isSidebarLaunch', () => {
    it('recognizes sidebar scenes', () => {
        for (const scene of ['021036', '101036', '181036', '261036']) {
            expect(isSidebarLaunch({ scene, query: {} })).toBe(true);
        }
    });

    it('recognizes launch_from and location', () => {
        expect(isSidebarLaunch({ scene: '', query: {}, launchFrom: 'homepage', location: 'sidebar_card' })).toBe(true);
    });

    it('rejects other entries', () => {
        expect(isSidebarLaunch({ scene: '011004', query: {}, launchFrom: 'homepage' })).toBe(false);
        expect(isSidebarLaunch({ scene: '21036', query: {} })).toBe(false);
    });
});

describe('normalizeLaunchOptions', () => {
    it('stringifies scene and query values and keeps douyin fields', () => {
        expect(
            normalizeLaunchOptions({
                scene: 1001,
                query: { a: 1, b: 'x', c: null },
                launch_from: 'homepage',
                location: 'sidebar_card',
            }),
        ).toEqual({ scene: '1001', query: { a: '1', b: 'x' }, launchFrom: 'homepage', location: 'sidebar_card' });
    });

    it('returns empty options for missing input', () => {
        expect(normalizeLaunchOptions(undefined)).toEqual({ scene: '', query: {} });
    });
});

describe('helpers', () => {
    it('parses query strings', () => {
        expect(parseQueryString('?a=1&b=hello%20world&c&d=x+y')).toEqual({ a: '1', b: 'hello world', c: '', d: 'x y' });
    });

    it('maps network types', () => {
        expect(toNetworkType('WIFI')).toBe('wifi');
        expect(toNetworkType('6g')).toBe('unknown');
        expect(toNetworkType(undefined)).toBe('unknown');
    });

    it('reads errCode or errNo', () => {
        expect(errorCodeOf({ errCode: 2002 })).toBe(2002);
        expect(errorCodeOf({ errNo: 21101 })).toBe(21101);
        expect(errorCodeOf('x')).toBeUndefined();
    });
});
