import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { PairIndex } from '../src/pairs';
import { PairSuggest } from '../src/suggest';
import { effectiveOptions, DEFAULT_SETTINGS } from '../src/settings';

function setup() {
	const app = App.createConfigured__({ files: { 'Host.md': 'Read #book ' } });
	const index = new PairIndex();
	index.set('A.md', ['book', 'fiction', 'novel']);
	index.set('B.md', ['book', 'fiction']);
	const suggest = new PairSuggest(app as never, () => index, () => effectiveOptions(DEFAULT_SETTINGS, false));
	let line = 'Read #book ';
	const editor = {
		getLine: () => line,
		lastLine: () => 0,
		getValue: () => line,
		transaction: vi.fn((tx: { changes: { from: { ch: number }; text: string }[] }) => {
			const c = tx.changes[0]!;
			line = line.slice(0, c.from.ch) + c.text + line.slice(c.from.ch);
		}),
	};
	const file = { path: 'Host.md', parent: { path: '' } };
	const ctx = { editor, file, start: { line: 0, ch: 11 }, end: { line: 0, ch: 11 }, query: 'book' };
	return { suggest, editor, file, ctx, text: () => line };
}

describe('PairSuggest without the internal members', () => {
	it('does not crash and the pick still adds the tag when suggestions and trigger are missing', () => {
		const { suggest, editor, ctx, text } = setup();
		const s = suggest as unknown as Record<string, unknown>;
		// The mock throws on a property that it does not know, so the test sets both to undefined (same as missing).
		s.suggestions = undefined;
		s.trigger = undefined;
		expect(s.suggestions).toBeUndefined();
		expect(s.trigger).toBeUndefined();
		suggest.context = ctx as never;
		const items = suggest.getSuggestions(ctx as never);
		expect(items.map((x) => x.tag)).toEqual(['fiction', 'novel']);
		// Core pick path (Enter after Up/Down or a click): the public selectSuggestion.
		expect(() => suggest.selectSuggestion(items[0]!, new MouseEvent('click'))).not.toThrow();
		expect(text()).toBe('Read #book #fiction ');
		expect(editor.transaction).toHaveBeenCalledTimes(1);
		// Shift+Enter and Tab fall back to the first tag of the box.
		suggest.context = { ...ctx, start: { line: 0, ch: 20 }, end: { line: 0, ch: 20 } } as never;
		expect(suggest.accept(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(false);
		expect(text()).toBe('Read #book #fiction #fiction ');
	});

	it('lets a plain Enter pass to the editor until Up or Down moved the highlight', () => {
		const { suggest } = setup();
		const enter = new KeyboardEvent('keydown', { key: 'Enter' });
		expect(suggest.onAnyKey(enter)).toBe(true);
		expect(suggest.moved).toBe(false);
		expect(suggest.onAnyKey(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBeUndefined();
		expect(suggest.moved).toBe(true);
		expect(suggest.onAnyKey(enter)).toBeUndefined();
		suggest.close();
		expect(suggest.moved).toBe(false);
		expect(suggest.onAnyKey(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBeUndefined();
	});
});
