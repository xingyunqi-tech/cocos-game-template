export type TrackParams = Record<string, string | number | boolean | null | undefined>;

export interface TrackEvent {
    event: string;
    params: TrackParams;
    time: number;
}

export type TrackSink = (event: TrackEvent) => void;

export class Tracker {
    private sinks: TrackSink[] = [];
    private common: TrackParams = {};

    setCommonParams(params: TrackParams) {
        this.common = { ...this.common, ...params };
    }

    addSink(sink: TrackSink): () => void {
        this.sinks.push(sink);
        return () => {
            this.sinks = this.sinks.filter((s) => s !== sink);
        };
    }

    track(event: string, params: TrackParams = {}) {
        const record: TrackEvent = { event, params: { ...this.common, ...params }, time: Date.now() };
        for (const sink of this.sinks) {
            try {
                sink(record);
            } catch {
                continue;
            }
        }
    }
}

export const tracker = new Tracker();

export function track(event: string, params?: TrackParams) {
    tracker.track(event, params);
}
