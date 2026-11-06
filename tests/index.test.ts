import { describe, expect, it } from 'vitest';
import { PairIndex, triggerOnLine } from '../src/pairs';
import { GROWTH_LIMIT, growth } from './growth';

/** A small seeded random generator, so the test gives the same vault each run. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

function vault(n: number, seed = 7): Map<string, string[]> {
	const r = rng(seed);
	const out = new Map<string, string[]>();
	for (let i = 0; i < n; i++) {
		const k = 1 + Math.floor(r() * 6);
		const tags: string[] = [];
		for (let j = 0; j < k; j++) {
			const t = Math.floor(r() ** 2 * 400);
			tags.push(t % 10 === 0 ? `area${t % 7}/topic${t}` : `tag${t}`);
		}
		out.set(`f${i % 50}/n${i}.md`, tags);
	}
	return out;
}

function snapshot(index: PairIndex, anchors: string[]): unknown {
	return anchors.map((a) => [a, index.rank(a, { limit: 1000 })]);
}

describe('PairIndex incremental updates', () => {
	it('gives the same ranks as a full rebuild after change, delete and rename', () => {
		const notes = vault(600);
		const live = new PairIndex();
		for (const [p, t] of notes) live.set(p, t);
		const r = rng(3);
		const paths = [...notes.keys()];
		for (let i = 0; i < 400; i++) {
			const p = paths[Math.floor(r() * paths.length)]!;
			const op = r();
			if (op < 0.5) {
				const t = [`tag${Math.floor(r() * 50)}`, `Tag${Math.floor(r() * 50)}`, 'area1/topic10'];
				notes.set(p, t);
				live.set(p, t);
			} else if (op < 0.75) {
				notes.delete(p);
				live.remove(p);
			} else {
				const np = `moved/${i}-${p}`;
				const t = notes.get(p);
				live.rename(p, np);
				if (t) {
					notes.delete(p);
					notes.set(np, t);
				}
				paths.push(np);
			}
		}
		const fresh = new PairIndex();
		for (const [p, t] of notes) fresh.set(p, t);
		const anchors = ['tag0', 'tag1', 'tag5', 'tag33', 'area1', 'area1/topic10', 'area3', 'tag49'];
		expect(snapshot(live, anchors)).toEqual(snapshot(fresh, anchors));
		expect(live.size).toBe(fresh.size);
	});

	it('moves every note of a renamed folder', () => {
		const index = new PairIndex();
		index.set('A/x.md', ['a', 'b']);
		index.set('A/sub/y.md', ['a', 'c']);
		index.set('AB/z.md', ['a', 'd']);
		index.rename('A', 'C');
		expect(index.tagsOf('C/x.md')).toEqual(['a', 'b']);
		expect(index.tagsOf('C/sub/y.md')).toEqual(['a', 'c']);
		expect(index.tagsOf('AB/z.md')).toEqual(['a', 'd']);
		expect(index.rank('a', { scope: (p) => p.startsWith('C/') }).map((x) => x.tag)).toEqual(['b', 'c']);
	});

	it('removes all counts when every note is deleted', () => {
		const index = new PairIndex();
		index.set('a.md', ['x', 'y']);
		index.set('b.md', ['#X', 'z']);
		index.remove('a.md');
		index.remove('b.md');
		expect(index.size).toBe(0);
		expect(index.rank('x')).toEqual([]);
	});

	it('keeps the casing that most notes use', () => {
		const index = new PairIndex();
		index.set('a.md', ['x', 'Novel']);
		index.set('b.md', ['x', 'novel']);
		index.set('c.md', ['x', 'Novel']);
		expect(index.rank('x')).toEqual([{ tag: 'novel', display: 'Novel', count: 3 }]);
	});

	it('builds an index of 10,000 notes and ranks, in time that grows linearly with the note count', () => {
		const indexOf = (n: number) => {
			const index = new PairIndex();
			for (const [p, t] of vault(n, 11)) index.set(p, t);
			return index;
		};
		expect(indexOf(10_000).size).toBe(10_000);
		// Growth guards (s1101): 10,000 notes against 1,000 notes, timed in this test.
		const build = growth((n) => {
			const notes = vault(n, 11);
			return () => {
				const index = new PairIndex();
				for (const [p, t] of notes) index.set(p, t);
			};
		}, 10_000);
		expect(build.ratio, `build: ${build.text}`).toBeLessThan(GROWTH_LIMIT);
		const rank = growth((n) => {
			const index = indexOf(n);
			return () => {
				for (let i = 0; i < 100; i++) index.rank('tag1');
			};
		}, 10_000);
		expect(rank.ratio, `rank: ${rank.text}`).toBeLessThan(GROWTH_LIMIT);
	});

	it('checks a long line for a trigger in time that grows at most linearly with the line length', () => {
		// Growth guard (s1101): 20,000 words against 2,000 words, 1,000 checks each, timed in this test.
		const g = growth((n) => {
			const line = 'word '.repeat(n) + 'x';
			return () => {
				for (let i = 0; i < 1000; i++) triggerOnLine(line);
			};
		}, 20_000);
		expect(g.ratio, g.text).toBeLessThan(GROWTH_LIMIT);
	});
});
