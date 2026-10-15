import { HttpError, type HttpTransport, type TransportRequest, type TransportResponse } from './types';

function parseHeaders(raw: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    return headers;
}

export class XhrTransport implements HttpTransport {
    send(request: TransportRequest): Promise<TransportResponse> {
        return new Promise((resolve, reject) => {
            if (request.signal?.cancelled) {
                reject(new HttpError('aborted', '请求已取消'));
                return;
            }
            const xhr = new XMLHttpRequest();
            let settled = false;
            let detach: () => void = () => undefined;
            const timer = setTimeout(() => {
                finish(() => reject(new HttpError('timeout', `请求超时 ${request.timeoutMs}ms`)));
                xhr.abort();
            }, request.timeoutMs);
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                detach();
                fn();
            };
            if (request.signal) {
                detach = request.signal.onCancel(() => {
                    finish(() => reject(new HttpError('aborted', '请求已取消')));
                    xhr.abort();
                });
            }

            xhr.open(request.method, request.url, true);
            xhr.timeout = request.timeoutMs;
            for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
            xhr.onload = () =>
                finish(() =>
                    resolve({
                        status: xhr.status,
                        body: typeof xhr.responseText === 'string' ? xhr.responseText : '',
                        headers: parseHeaders(xhr.getAllResponseHeaders() ?? ''),
                    }),
                );
            xhr.ontimeout = () => finish(() => reject(new HttpError('timeout', `请求超时 ${request.timeoutMs}ms`)));
            xhr.onerror = () => finish(() => reject(new HttpError('network', '网络错误')));
            xhr.onabort = () => finish(() => reject(new HttpError('aborted', '请求已取消')));
            xhr.send(request.body ?? null);
        });
    }
}
