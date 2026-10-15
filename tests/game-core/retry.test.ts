import { describe, expect, it, vi } from 'vitest';
import { retry } from 'db://game-core/boot/retry';

describe('retry', () => {
    it('returns the first successful result', async () => {
        const task = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('a')).mockResolvedValue('ok');
        await expect(retry(task, 3)).resolves.toBe('ok');
        expect(task).toHaveBeenCalledTimes(2);
    });

    it('throws the last error after all attempts fail', async () => {
        const task = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error('first'))
            .mockRejectedValueOnce(new Error('second'))
            .mockRejectedValueOnce(new Error('third'));
        await expect(retry(task, 3)).rejects.toThrow('third');
        expect(task).toHaveBeenCalledTimes(3);
    });
});
