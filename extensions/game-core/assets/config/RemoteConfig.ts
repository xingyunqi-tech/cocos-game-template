export type RemoteFetcher<T> = () => Promise<Partial<T>>;

export type RemoteSource = 'defaults' | 'remote';

export class RemoteConfig<T extends object> {
    private values: T;
    private currentSource: RemoteSource = 'defaults';

    constructor(private readonly defaults: T) {
        this.values = { ...defaults };
    }

    get<K extends keyof T>(key: K): T[K] {
        return this.values[key];
    }

    all(): Readonly<T> {
        return this.values;
    }

    get source(): RemoteSource {
        return this.currentSource;
    }

    async load(fetcher?: RemoteFetcher<T>, timeoutMs = 3000): Promise<RemoteSource> {
        this.values = { ...this.defaults };
        this.currentSource = 'defaults';
        if (!fetcher) return this.currentSource;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const remote = await Promise.race([
                fetcher(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error('远程配置超时')), timeoutMs);
                }),
            ]);
            this.values = { ...this.defaults, ...remote };
            this.currentSource = 'remote';
        } catch {
            this.currentSource = 'defaults';
        } finally {
            clearTimeout(timer);
        }
        return this.currentSource;
    }
}
