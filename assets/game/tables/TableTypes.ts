// 由 npm run tables 生成，不要手改

export interface DemoLevelRow {
    /** 关卡编号 */
    id: number;
    /** 关卡名 */
    name: string;
    /** 时长（秒） */
    duration: number;
    /** 出现间隔（秒） */
    spawnInterval: number;
    /** 目标停留（秒） */
    targetLife: number;
    /** 目标半径 */
    radius: number;
    /** 标签 */
    tags: string[];
}

declare module 'db://game-core/augment' {
    interface TableMap {
        demo_level: DemoLevelRow;
    }
}
