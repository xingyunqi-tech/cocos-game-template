import { oops } from 'db://oops-framework/core/Oops';
import { LayerType } from 'db://oops-framework/core/gui/layer/LayerEnum';
import type { UIConfig } from 'db://oops-framework/core/gui/layer/UIConfig';

export const DEMO_BUNDLE = 'demo';

export enum UIID {
    Rank = 'demo/rank',
}

export interface RankParams {
    best: number;
    recent: number[];
}

const UI_CONFIG: Record<UIID, UIConfig> = {
    [UIID.Rank]: { layer: LayerType.Dialog, prefab: 'prefab/rank', bundle: DEMO_BUNDLE, mask: true },
};

/** oops.gui 在 Root 初始化后才存在，须在游戏入口中调用 */
export function registerDemoUI() {
    oops.gui.init(UI_CONFIG);
}

export function openRank(params: RankParams) {
    return oops.gui.open(UIID.Rank, { data: params });
}
