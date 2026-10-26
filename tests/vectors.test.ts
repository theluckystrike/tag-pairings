import { describe, expect, it } from 'vitest';
import vectors from './vectors/tag-pairings.json';
import { ancestors, lineTags, rankPairs, triggerAt } from '../src/pairs';

const fns: Record<string, (...args: never[]) => unknown> = { rankPairs, triggerAt, lineTags, ancestors };

describe('golden vectors (packages/spec/vectors/tag-pairings.json)', () => {
	it('covers acceptance criteria 1 to 5', () => {
		for (const n of ['1', '2', '3', '4', '5']) expect(vectors.cases.some((c) => c.name.startsWith(`${n} `))).toBe(true);
		expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const fn = fns[c.fn];
			expect(fn).toBeTypeOf('function');
			expect(fn!(...(c.args as never[]))).toEqual(c.expected);
		});
	}
});
