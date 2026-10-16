import { userSave } from 'db://game-core';

export interface DemoData {
    best: number;
    coins: number;
    plays: number;
    /** 最近的成绩，最新在前 */
    recent: number[];
}

export const RECENT_LIMIT = 10;

const slot = userSave.slot<DemoData>('demo', {
    version: 1,
    defaults: () => ({ best: 0, coins: 0, plays: 0, recent: [] }),
});

export const demoSave = {
    get: (): Readonly<DemoData> => slot.get(),
    /** 记录一局成绩，返回是否刷新最高分 */
    recordGame(score: number): boolean {
        const data = slot.get();
        const record = score > data.best;
        slot.set({
            best: Math.max(data.best, score),
            coins: data.coins + score,
            plays: data.plays + 1,
            recent: [score, ...data.recent].slice(0, RECENT_LIMIT),
        });
        return record;
    },
    addCoins(amount: number) {
        slot.update((data) => {
            data.coins += amount;
        });
    },
};
