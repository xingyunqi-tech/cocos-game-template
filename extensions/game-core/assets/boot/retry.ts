export async function retry<T>(task: () => Promise<T>, attempts: number): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await task();
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}
