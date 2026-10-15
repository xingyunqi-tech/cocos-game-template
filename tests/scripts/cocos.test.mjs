import { describe, expect, it } from 'vitest';
import { judgeBuild } from '../../scripts/lib/cocos.mjs';

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
