import { describe, expect, it, vi } from 'vitest';

vi.mock('db://oops-framework/core/Oops', () => ({ oops: {} }));

import { configProblem } from 'db://game-core/config/env';

describe('configProblem', () => {
    it('accepts a type that has an environment entry', () => {
        expect(configProblem({ type: 'dev', config: { dev: { httpServer: '' } } })).toBeNull();
    });

    it('reports a type without an environment entry', () => {
        expect(configProblem({ type: 'staging', config: { dev: {} } })).toContain('staging');
        expect(configProblem({ type: 'toString', config: {} })).toContain('toString');
        expect(configProblem({ type: 'dev', config: { dev: null } })).toContain('dev');
        expect(configProblem({ type: 'dev', config: { dev: [] } })).toContain('dev');
    });

    it('reports a config without type or environments', () => {
        expect(configProblem({})).not.toBeNull();
        expect(configProblem(null)).not.toBeNull();
    });
});
