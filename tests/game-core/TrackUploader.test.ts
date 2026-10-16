import { describe, expect, it, vi } from 'vitest';
import { TrackUploader, type UploadRecord } from 'db://game-core/monitor/TrackUploader';

const record = (event: string): UploadRecord => ({ event, params: {}, time: 0 });

function manualTimer() {
    let pending: (() => void) | null = null;
    return {
        schedule: (fn: () => void) => {
            pending = fn;
            return 1;
        },
        cancelSchedule: () => {
            pending = null;
        },
        fire: () => pending?.(),
        armed: () => pending !== null,
    };
}

describe('TrackUploader', () => {
    it('sends a batch when the buffer reaches the batch size', async () => {
        const send = vi.fn(() => Promise.resolve());
        const uploader = new TrackUploader({ send, batchSize: 2, ...manualTimer() });
        uploader.push(record('a'));
        expect(send).not.toHaveBeenCalled();
        uploader.push(record('b'));
        await uploader.flush();
        expect(send).toHaveBeenCalledWith([record('a'), record('b')]);
        expect(uploader.pending).toBe(0);
    });

    it('sends on the interval timer', async () => {
        const timer = manualTimer();
        const send = vi.fn(() => Promise.resolve());
        const uploader = new TrackUploader({ send, ...timer });
        uploader.push(record('a'));
        expect(timer.armed()).toBe(true);
        timer.fire();
        await uploader.flush();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('requeues failed batches and caps the buffer', async () => {
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.reject(new Error('offline')));
        const uploader = new TrackUploader({ send, batchSize: 10, maxBuffer: 3, ...manualTimer() });
        ['a', 'b', 'c'].forEach((e) => uploader.push(record(e)));
        await uploader.flush();
        expect(uploader.pending).toBe(3);
        uploader.push(record('d'));
        expect(uploader.pending).toBe(3);
        send.mockImplementation(() => Promise.resolve());
        await uploader.flush();
        const last = send.mock.calls[send.mock.calls.length - 1][0];
        expect(last.map((r) => r.event)).toEqual(['b', 'c', 'd']);
    });

    it('flushes every batch on flushAll and stops on failure', async () => {
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.resolve());
        const uploader = new TrackUploader({ send, batchSize: 2, ...manualTimer() });
        uploader.push(record('a'));
        await uploader.flush();
        ['b', 'c', 'd', 'e'].forEach((e) => uploader.push(record(e)));
        await uploader.flushAll();
        expect(uploader.pending).toBe(0);
        send.mockImplementation(() => Promise.reject(new Error('offline')));
        uploader.push(record('f'));
        await uploader.flushAll();
        expect(uploader.pending).toBe(1);
    });

    it('drops batches that fail permanently and backs off on retryable failures', async () => {
        const delays: number[] = [];
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.reject(new Error('400')));
        const uploader = new TrackUploader({
            send,
            batchSize: 10,
            intervalMs: 1000,
            isPermanent: (err) => (err as Error).message === '400',
            schedule: (_fn, ms) => {
                delays.push(ms);
                return 1;
            },
            cancelSchedule: () => undefined,
        });
        uploader.push(record('bad'));
        await uploader.flush();
        expect(uploader.pending).toBe(0);
        send.mockImplementation(() => Promise.reject(new Error('503')));
        uploader.push(record('a'));
        await uploader.flush();
        await uploader.flush();
        expect(uploader.pending).toBe(1);
        expect(delays.slice(-2)).toEqual([2000, 4000]);
    });

    it('keeps records when send throws synchronously', async () => {
        const uploader = new TrackUploader({
            send: () => {
                throw new Error('sync');
            },
            ...manualTimer(),
        });
        uploader.push(record('a'));
        await uploader.flush();
        expect(uploader.pending).toBe(1);
    });

    it('does not send concurrently', async () => {
        let release!: () => void;
        const send = vi.fn((): Promise<void> =>
            send.mock.calls.length === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve(),
        );
        const uploader = new TrackUploader({ send, batchSize: 1, ...manualTimer() });
        uploader.push(record('a'));
        uploader.push(record('b'));
        expect(send).toHaveBeenCalledTimes(1);
        release();
        await uploader.flush();
        await uploader.flush();
        expect(send).toHaveBeenCalledTimes(2);
    });
});
