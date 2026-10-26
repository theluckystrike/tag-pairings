import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Scope } from 'obsidian-test-mocks/obsidian';
import { PairIndex } from '../src/pairs';
import { PairSuggest } from '../src/suggest';
import { effectiveOptions, DEFAULT_SETTINGS } from '../src/settings';

function setup(start = 'Read #book ', lines: string[] = []) {
	const app = App.createConfigured__({ files: { 'Host.md': start } });
	const index = new PairIndex();
	index.set('A.md', ['book', 'fiction', 'novel']);
	index.set('B.md', ['book', 'fiction']);
	index.set('C.md', ['book', 'art']);
	const suggest = new PairSuggest(app as never, () => index, () => effectiveOptions(DEFAULT_SETTINGS, false));
	// The mock throws on a property that it does not know, so the tests set the internal list to undefined (same as
	// missing). Then Shift+Enter and Tab use the fallback: the first tag of the box.
	(suggest as unknown as Record<string, unknown>).suggestions = undefined;
	(suggest as unknown as Record<string, unknown>).trigger = undefined;
	const all = [...lines, start];
	const at = all.length - 1;
	const editor = {
		getLine: (i: number) => all[i] ?? '',
		lastLine: () => at,
		getValue: () => all.join('\n'),
		transaction: vi.fn((tx: { changes: { from: { ch: number }; text: string }[] }) => {
			const c = tx.changes[0]!;
			all[at] = all[at]!.slice(0, c.from.ch) + c.text + all[at]!.slice(c.from.ch);
		}),
	};
	const file = { path: 'Host.md', parent: { path: '' } };
	const ctx = (ch = all[at]!.length) => ({ editor, file, start: { line: at, ch }, end: { line: at, ch }, query: 'book' });
	return { app, suggest, editor, file, ctx, text: () => all[at]! };
}

/** Opens the box in the test: sets the context and lists the tags (the base class does this in the app). */
function open(s: ReturnType<typeof setup>) {
	const c = s.ctx();
	s.suggest.context = c as never;
	return s.suggest.getSuggestions(c as never);
}

const key = (k: string, o: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, ...o });

afterEach(() => {
	vi.restoreAllMocks();
});

describe('PairSuggest without the internal members', () => {
	it('does not crash and the pick still adds the tag when suggestions and trigger are missing', () => {
		const s = setup();
		const raw = s.suggest as unknown as Record<string, unknown>;
		expect(raw.suggestions).toBeUndefined();
		expect(raw.trigger).toBeUndefined();
		const items = open(s);
		expect(items.map((x) => x.tag)).toEqual(['fiction', 'art', 'novel']);
		// Core pick path (Enter after Up/Down or a click): the public selectSuggestion.
		expect(() => s.suggest.selectSuggestion(items[0]!, new MouseEvent('click'))).not.toThrow();
		expect(s.text()).toBe('Read #book #fiction ');
		expect(s.editor.transaction).toHaveBeenCalledTimes(1);
		// Shift+Enter and Tab fall back to the first tag of the box. The box is open again for the new line.
		expect(open(s).map((x) => x.tag)).toEqual(['art', 'novel']);
		expect(s.suggest.accept(key('Enter', { shiftKey: true }))).toBe(false);
		expect(s.text()).toBe('Read #book #fiction #art ');
	});

	it('accept does nothing after close, and Shift+Enter adds no duplicate tag', () => {
		const s = setup();
		const items = open(s);
		s.suggest.selectSuggestion(items[0]!, new MouseEvent('click'));
		expect(s.text()).toBe('Read #book #fiction ');
		// The box is closed (reopen needs the internal trigger). Shift+Enter and Tab must give the key to the editor.
		s.suggest.context = s.ctx() as never;
		expect(s.suggest.accept(key('Enter', { shiftKey: true }))).toBeUndefined();
		expect(s.suggest.accept(key('Tab'))).toBeUndefined();
		expect(s.text()).toBe('Read #book #fiction ');
		const tags = s.text().match(/#\S+/gu) ?? [];
		expect(new Set(tags).size).toBe(tags.length);
	});

	it('no internal key list: the constructor does not throw and the catch-all handler stays after the base handlers', () => {
		const base = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].map((k) => ({ key: k }));
		const handlers: { key: string | null }[] = [...base];
		const fake = {
			register: (_m: unknown, k: string | null) => {
				const h = { key: k };
				handlers.push(h);
				return h;
			},
			unregister: () => undefined,
		};
		vi.spyOn(Scope, 'create__').mockImplementation(() => fake as never);
		expect(() => setup()).not.toThrow();
		expect(handlers.map((h) => h.key)).toEqual(['ArrowUp', 'ArrowDown', 'Enter', 'Escape', null, 'Enter', 'Tab']);
	});

	it('with the internal key list the catch-all handler runs first', () => {
		const keys: { key: string | null }[] = ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].map((k) => ({ key: k }));
		const fake = {
			keys,
			register: (_m: unknown, k: string | null) => {
				const h = { key: k };
				keys.push(h);
				return h;
			},
			unregister: () => undefined,
		};
		vi.spyOn(Scope, 'create__').mockImplementation(() => fake as never);
		setup();
		expect(keys.map((h) => h.key)).toEqual([null, 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Enter', 'Tab']);
	});
});

describe('PairSuggest keys', () => {
	it('lets a plain Enter pass to the editor until Up or Down moved the highlight', () => {
		const { suggest } = setup();
		const enter = key('Enter');
		expect(suggest.onAnyKey(enter)).toBe(true);
		expect(suggest.moved).toBe(false);
		expect(suggest.onAnyKey(key('ArrowDown'))).toBeUndefined();
		expect(suggest.moved).toBe(true);
		expect(suggest.onAnyKey(enter)).toBeUndefined();
		suggest.close();
		expect(suggest.moved).toBe(false);
		expect(suggest.onAnyKey(key('Enter', { shiftKey: true }))).toBeUndefined();
	});

	it('Tab on a list item line passes to the editor until Up or Down moved the highlight', () => {
		for (const line of ['- buy milk #book ', '- [ ] call Bob #book ', '\t* nested #book ', '1. first #book ', '2) second #book ']) {
			const s = setup(line);
			open(s);
			// No move: the box closes and the editor gets the Tab (it indents the item).
			expect(s.suggest.accept(key('Tab')), line).toBe(true);
			expect(s.text()).toBe(line);
			// The box is closed now: a second Tab also goes to the editor.
			expect(s.suggest.accept(key('Tab'))).toBeUndefined();
			// After Down, Tab adds the highlighted tag.
			open(s);
			s.suggest.onAnyKey(key('ArrowDown'));
			expect(s.suggest.accept(key('Tab'))).toBe(false);
			expect(s.text()).toBe(line + '#fiction ');
		}
	});

	it('Tab and Shift+Enter on a line that is not a list item add the tag; Shift+Enter on a list item adds the tag', () => {
		for (const line of ['Read #book ', '-not a list #book ', '> quote #book ']) {
			const s = setup(line);
			open(s);
			expect(s.suggest.accept(key('Tab')), line).toBe(false);
			expect(s.text()).toBe(line + '#fiction ');
		}
		const s = setup('- buy milk #book ');
		open(s);
		expect(s.suggest.accept(key('Enter', { shiftKey: true }))).toBe(false);
		expect(s.text()).toBe('- buy milk #book #fiction ');
	});
});

describe('note tag exclusion', () => {
	it('a front matter tag that is part of a word is not excluded', () => {
		// The cache still has "art" in the front matter; the editor text has "start" only (the user edited it).
		const s = setup('Read #book ', ['---', 'tags: [start]', '---']);
		vi.spyOn(s.app.metadataCache, 'getFileCache').mockReturnValue({
			frontmatter: { tags: ['art'] },
			frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 2, col: 3, offset: 20 } },
		} as never);
		expect(open(s).map((x) => x.tag)).toEqual(['fiction', 'art', 'novel']);
	});

	it('a front matter tag that is a whole word is excluded', () => {
		const s = setup('Read #book ', ['---', 'tags: [art]', '---']);
		vi.spyOn(s.app.metadataCache, 'getFileCache').mockReturnValue({
			frontmatter: { tags: ['art'] },
			frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 2, col: 3, offset: 18 } },
		} as never);
		expect(open(s).map((x) => x.tag)).toEqual(['fiction', 'novel']);
	});
});
