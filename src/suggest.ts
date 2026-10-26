import { EditorSuggest, parseFrontMatterTags, type App, type Editor, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, type TFile } from 'obsidian';
import { frontmatterEnd, inBlockContext, lineTags, triggerOnLine, type PairIndex, type Pairing } from './pairs';
import type { Effective } from './settings';

/** Internal list of a popover suggest. Core uses it for its own Shift+Enter keys; it is not in obsidian.d.ts. */
interface SuggestList {
	useSelectedItem(evt: KeyboardEvent): boolean;
}

/** Internal trigger of an editor suggest: runs onTrigger and, with open true, shows the box. Not in obsidian.d.ts. */
type TriggerFn = (editor: Editor, file: TFile, open: boolean) => boolean;

/** Keys that move the highlight. A press of one of them lets Enter add the highlighted tag. */
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown']);

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The suggestion box. It opens when the text before the cursor ends with "#tag" and one space, and lists the tags
 * that occur with that tag in the vault. Shift+Enter, Tab or a click adds the highlighted tag ("#other ") and the box
 * opens again for the new tag. Enter adds a tag only after the user moved the highlight with Up or Down; otherwise
 * Enter closes the box and makes a new line as usual.
 */
export class PairSuggest extends EditorSuggest<Pairing> {
	private anchor = '';
	/** True after Up or Down in the open box. Reset each time the box closes. */
	moved = false;
	/** The list shown last, for the fallback when the internal list is missing. */
	private shown: Pairing[] = [];

	constructor(
		app: App,
		private readonly index: () => PairIndex | null,
		private readonly options: () => Effective,
	) {
		super(app);
		this.setInstructions([
			{ command: '↑↓', purpose: 'to move' },
			{ command: 'shift ↵ or tab', purpose: 'to add the tag' },
			{ command: '↵', purpose: 'to add after ↑↓, else new line' },
			{ command: 'esc', purpose: 'to dismiss' },
		]);
		// A handler for every key that runs before the handlers of the base class. It notes Up and Down and lets a plain
		// Enter pass to the editor while the user has not moved the highlight. The order of scope keys is internal; without
		// it, the handler goes last and Enter adds the tag as in core suggest boxes.
		const any = this.scope.register(null, null, (evt) => this.onAnyKey(evt));
		try {
			const keys = (this.scope as unknown as { keys?: unknown[] }).keys;
			if (Array.isArray(keys) && keys[keys.length - 1] === any) keys.unshift(keys.pop());
		} catch {
			// No internal key list: the handler stays last.
		}
		this.scope.register(['Shift'], 'Enter', (evt) => this.accept(evt));
		this.scope.register([], 'Tab', (evt) => this.accept(evt));
	}

	/** Runs first for each key in the open box. Returns true to give the key to the editor, undefined to go on. */
	onAnyKey(evt: KeyboardEvent): boolean | undefined {
		if (evt.isComposing) return undefined;
		if (MOVE_KEYS.has(evt.key) && !evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey) {
			this.moved = true;
			return undefined;
		}
		if (evt.key === 'Enter' && !evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey && !this.moved) {
			// Close the box and let the editor make the new line (with list continuation).
			this.close();
			return true;
		}
		return undefined;
	}

	/** Adds the highlighted tag (Shift+Enter, Tab). Without the internal list, adds the first tag of the box. */
	accept(evt: KeyboardEvent): false | undefined {
		if (evt.isComposing) return undefined;
		const list = (this as unknown as { suggestions?: SuggestList }).suggestions;
		if (list && typeof list.useSelectedItem === 'function') {
			list.useSelectedItem(evt);
			return false;
		}
		const first = this.shown[0];
		if (first && this.context) {
			this.selectSuggestion(first, evt);
			return false;
		}
		return undefined;
	}

	close(): void {
		this.moved = false;
		super.close();
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) return null;
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const t = triggerOnLine(before);
		if (!t) return null;
		// Front matter from the metadata cache; before the cache has the note, a closed "---" block at line 0.
		const cached = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.line;
		const last = editor.lastLine();
		const fm = cached ?? frontmatterEnd((i) => (i <= last ? editor.getLine(i) : undefined));
		if (inBlockContext((i) => editor.getLine(i), cursor.line, fm)) return null;
		const index = this.index();
		if (!index || index.size === 0) return null;
		this.anchor = t.anchor;
		return { start: cursor, end: cursor, query: t.anchor };
	}

	getSuggestions(context: EditorSuggestContext): Pairing[] {
		const index = this.index();
		if (!index) return [];
		const opts = this.options();
		const { editor } = context;
		// Body tags from the editor text (the cache is about 2 seconds behind it). Front matter tags from the cache, when
		// the tag is still a whole word in the front matter text of the editor.
		const exclude = new Set<string>();
		const last = editor.lastLine();
		for (let i = 0; i <= last; i++) for (const k of lineTags(editor.getLine(i))) exclude.add(k);
		const cache = this.app.metadataCache.getFileCache(context.file);
		const fmTags = parseFrontMatterTags(cache?.frontmatter) ?? [];
		const fmLast = cache?.frontmatterPosition?.end.line ?? -1;
		if (fmTags.length > 0 && fmLast > 0) {
			const fmText: string[] = [];
			for (let i = 0; i <= Math.min(fmLast, last); i++) fmText.push(editor.getLine(i));
			const text = fmText.join('\n');
			for (const t of fmTags) {
				const key = (t.startsWith('#') ? t.slice(1) : t).toLowerCase();
				if (new RegExp(`(^|[\\s,\\[\\]"'#-])${escapeRe(key)}(?=$|[\\s,\\[\\]"'])`, 'imu').test(text)) exclude.add(key);
			}
		}
		const linked = Object.keys(this.app.metadataCache.resolvedLinks[context.file.path] ?? {});
		const folder = context.file.parent?.path ?? '';
		const scope = opts.folderScope && folder !== '' && folder !== '/' ? (p: string) => p.startsWith(folder + '/') : null;
		this.shown = index.rank(context.query, { exclude, linked, limit: opts.limit, scope });
		return this.shown;
	}

	renderSuggestion(value: Pairing, el: HTMLElement): void {
		el.addClass('tag-pairings-item');
		el.createSpan({ cls: 'tag-pairings-tag', text: '#' + value.display });
		if (this.options().showCounts) el.createSpan({ cls: 'tag-pairings-count', text: String(value.count) });
	}

	selectSuggestion(value: Pairing, _evt: MouseEvent | KeyboardEvent): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor, start, file } = ctx;
		this.close();
		const text = '#' + value.display + ' ';
		const at = { line: start.line, ch: start.ch };
		editor.transaction({ changes: [{ from: at, to: at, text }], selection: { from: { line: at.line, ch: at.ch + text.length } } });
		// Rule 8: open the box again for the tag just added. Obsidian runs the trigger only after a key press, not after
		// a change that code makes, so the plugin runs it here.
		this.reopen(editor, file);
	}

	/** Runs the trigger at the cursor and shows the box when a tag and a space are before it. */
	reopen(editor: Editor, file: TFile): void {
		const trigger = (this as unknown as { trigger?: TriggerFn }).trigger;
		if (typeof trigger === 'function') trigger.call(this, editor, file, true);
	}

	/** The anchor of the last trigger, for tests. */
	get lastAnchor(): string {
		return this.anchor;
	}
}
