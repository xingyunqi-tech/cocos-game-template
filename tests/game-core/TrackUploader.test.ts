import { describe, expect, it, vi } from 'vitest';
import { isPermanentUploadError, TrackUploader, type UploadRecord } from 'db://game-core/monitor/TrackUploader';
import { HttpError } from 'db://game-core/net/types';

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

function memoryPersist(initial: UploadRecord[] = []) {
    let saved = initial;
    return { load: () => saved, save: vi.fn((records: UploadRecord[]) => (saved = records)), saved: () => saved };
}

describe('TrackUploader persistence', () => {
    it('restores saved records that are not expired and sends them first', async () => {
        const timer = manualTimer();
        const persist = memoryPersist([
            { event: 'old', params: {}, time: 0 },
            { event: 'kept', params: {}, time: 900 },
            { event: 'bad' } as UploadRecord,
        ]);
        const send = vi.fn(() => Promise.resolve());
        const uploader = new TrackUploader({ send, persist, maxAgeMs: 500, now: () => 1000, ...timer });
        expect(uploader.pending).toBe(1);
        expect(timer.armed()).toBe(true);
        uploader.push(record('new'));
        await uploader.flush();
        expect(send).toHaveBeenCalledWith([{ event: 'kept', params: {}, time: 900 }, record('new')]);
        expect(persist.saved()).toEqual([]);
    });

    it('saves in-flight and queued records and keeps them in sync until the queue drains', async () => {
        let finish: () => void = () => undefined;
        const send = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        const persist = memoryPersist();
        const uploader = new TrackUploader({ send, persist, batchSize: 1, ...manualTimer() });
        uploader.push(record('a'));
        uploader.push(record('b'));
        uploader.persist();
        expect(persist.saved()).toEqual([record('a'), record('b')]);
        finish();
        await vi.waitFor(() => expect(persist.saved()).toEqual([record('b')]));
        void uploader.flush();
        finish();
        await vi.waitFor(() => expect(persist.saved()).toEqual([]));
        persist.save.mockClear();
        uploader.push(record('c'));
        void uploader.flush();
        finish();
        await uploader.flush();
        expect(persist.save).not.toHaveBeenCalled();
    });

    it('keeps failed batches in the saved records without rewriting them', async () => {
        const persist = memoryPersist();
        const uploader = new TrackUploader({
            send: () => Promise.reject(new Error('offline')),
            persist,
            ...manualTimer(),
        });
        uploader.push(record('a'));
        uploader.persist();
        persist.save.mockClear();
        await uploader.flush();
        expect(persist.saved()).toEqual([record('a')]);
        expect(persist.save).not.toHaveBeenCalled();
    });
});

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

    it('stops flushAll when the in-flight batch fails', async () => {
        let fail: (err: Error) => void = () => undefined;
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.reject(new Error('offline')));
        send.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
        const uploader = new TrackUploader({ send, ...manualTimer() });
        uploader.push(record('a'));
        const first = uploader.flush();
        const all = uploader.flushAll();
        fail(new HttpError('network', 'offline'));
        await first;
        await all;
        expect(send).toHaveBeenCalledTimes(1);
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

    it('waits for the backoff timer instead of sending each full batch after a failure', async () => {
        const timer = manualTimer();
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.reject(new Error('offline')));
        const uploader = new TrackUploader({ send, batchSize: 2, ...timer });
        uploader.push(record('a'));
        uploader.push(record('b'));
        await uploader.flush();
        expect(send).toHaveBeenCalledTimes(1);
        for (const e of ['c', 'd', 'e', 'f']) uploader.push(record(e));
        expect(send).toHaveBeenCalledTimes(1);
        expect(timer.armed()).toBe(true);
        send.mockImplementation(() => Promise.resolve());
        timer.fire();
        await uploader.flush();
        expect(send).toHaveBeenCalledTimes(2);
        uploader.push(record('g'));
        await uploader.flush();
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('schedules the next send from the result of an in-flight retry', async () => {
        const delays: number[] = [];
        let release!: () => void;
        const send = vi.fn<(records: UploadRecord[]) => Promise<void>>(() => Promise.reject(new Error('offline')));
        const uploader = new TrackUploader({
            send,
            batchSize: 1,
            intervalMs: 1000,
            schedule: (_fn, ms) => {
                delays.push(ms);
                return delays.length;
            },
            cancelSchedule: () => undefined,
        });
        uploader.push(record('a'));
        await uploader.flush();
        expect(delays).toEqual([2000]);
        send.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
        const retry = uploader.flush();
        uploader.push(record('b'));
        expect(delays).toEqual([2000]);
        release();
        await retry;
        expect(delays).toEqual([2000, 1000]);
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

describe('isPermanentUploadError', () => {
    it('drops batches on client errors, answered responses and non-HTTP errors', () => {
        expect(isPermanentUploadError(new Error('serialize'))).toBe(true);
        expect(isPermanentUploadError(new HttpError('http', 'bad', 400))).toBe(true);
        expect(isPermanentUploadError(new HttpError('http', 'forbidden', 403))).toBe(true);
        expect(isPermanentUploadError(new HttpError('parse', 'not json', 200))).toBe(true);
        expect(isPermanentUploadError(new HttpError('business', 'rejected', 200))).toBe(true);
        for (const status of [401, 408, 429, 500, 503]) {
            expect(isPermanentUploadError(new HttpError('http', 'x', status))).toBe(false);
        }
        expect(isPermanentUploadError(new HttpError('network', 'offline'))).toBe(false);
        expect(isPermanentUploadError(new HttpError('timeout', 'slow'))).toBe(false);
    });
});
