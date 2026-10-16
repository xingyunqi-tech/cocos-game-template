import { describe, expect, it } from 'vitest';
import { camelCase, moduleFiles, pascalCase } from '../../scripts/lib/scaffold.mjs';

describe('scaffold', () => {
    it('converts module names', () => {
        expect(pascalCase('daily-task')).toBe('DailyTask');
        expect(camelCase('daily-task')).toBe('dailyTask');
    });

    it('generates model, view and index files', () => {
        const files = moduleFiles('daily-task');
        expect(Object.keys(files)).toEqual(['DailyTaskModel.ts', 'DailyTaskView.ts', 'index.ts']);
        expect(files['DailyTaskModel.ts']).toContain("userSave.slot<DailyTaskData>('dailyTask'");
        expect(files['DailyTaskView.ts']).toContain('export function openDailyTaskView()');
        expect(files['index.ts']).toContain("export { openDailyTaskView } from './DailyTaskView';");
    });

    it('rejects invalid names', () => {
        expect(() => moduleFiles('Shop')).toThrow('模块名');
        expect(() => moduleFiles('my_shop')).toThrow('模块名');
        expect(() => moduleFiles('sidebar')).toThrow('存档 key 冲突');
    });
});
