import type { Rect, TopInset } from '../platform/types';

export interface DesignInset {
    /** 顶部 UI 应下移的距离（避开刘海与胶囊），设计分辨率单位 */
    top: number;
    /** 仅避开刘海与状态栏的距离，适合与胶囊同一行的左侧元素 */
    safeTop: number;
    /** 胶囊按钮区域，设计分辨率单位，原点在左上角 */
    menuRect?: Rect;
}

export const WEB_DEFAULT_TOP = 20;
export const MENU_GAP = 8;

/** 窗口逻辑像素换算为设计分辨率单位；无安全区信息时使用默认内边距 */
export function toDesignInset(
    inset: TopInset,
    windowWidth: number,
    visibleWidth: number,
    defaultTop = WEB_DEFAULT_TOP,
): DesignInset {
    const scale = windowWidth > 0 ? visibleWidth / windowWidth : 1;
    const menu = inset.menuRect;
    if (!menu && inset.safeTop <= 0) return { top: defaultTop, safeTop: defaultTop };
    const safeTop = inset.safeTop * scale;
    if (!menu) return { top: safeTop, safeTop };
    const menuRect: Rect = {
        left: menu.left * scale,
        top: menu.top * scale,
        width: menu.width * scale,
        height: menu.height * scale,
    };
    return { top: Math.max(safeTop, menuRect.top + menuRect.height + MENU_GAP), safeTop, menuRect };
}
