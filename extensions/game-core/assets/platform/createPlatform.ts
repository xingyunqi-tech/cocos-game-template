import { BYTEDANCE, WECHAT } from 'cc/env';
import { DouyinPlatform } from './impl/douyin';
import { WebPlatform, type WebHost } from './impl/web';
import { WechatPlatform } from './impl/wechat';
import type { IPlatform } from './types';

const HEADLESS_HOST: WebHost = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
};

export function createPlatform(options: { debug: boolean; host?: WebHost }): IPlatform {
    if (WECHAT) return new WechatPlatform();
    if (BYTEDANCE) return new DouyinPlatform();
    const host: WebHost = options.host ?? (typeof window === 'undefined' ? HEADLESS_HOST : window);
    return new WebPlatform(host, { debug: options.debug });
}
