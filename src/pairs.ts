// Pure logic of Tag Pairings: the tag pair index, the rank and the trigger check. No Obsidian imports.

/** One suggested tag. `tag` is the key (lower case, no #); `display` is the casing that the vault uses most. */
export interface Pairing {
	tag: string;
	display: string;
	/** Number of notes (in scope) that hold the anchor and this tag. */
	count: number;
}

export interface RankOptions {
	/** Tag keys to leave out: the tags of the note and of the current line. */
	exclude?: Iterable<string>;
	/** Paths of the notes that the current note links to. Their tags break ties. */
	linked?: Iterable<string>;
	/** Most tags to give. */
	limit?: number;
	/** Pro: count only the notes for which this gives true. */
	scope?: ((path: string) => boolean) | null;
}

/** The tag text without "#", in lower case. Obsidian matches tags without regard to case. */
export function tagKey(tag: string): string {
	return (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase();
}

/** The parents of a nested tag key: "a/b/c" gives ["a", "a/b"]. */
export function ancestors(key: string): string[] {
	const out: string[] = [];
	let i = key.indexOf('/');
	while (i > 0) {
		out.push(key.slice(0, i));
		i = key.indexOf('/', i + 1);
	}
	return out;
}

// Characters that Obsidian accepts in a tag: letters, marks, numbers, "_", "-", "/" and emoji.
const TAG_BODY = /^(?:[\p{L}\p{M}\p{N}_\-/\p{Extended_Pictographic}]|‍|️)+$/u;

/** True when text (without "#") is a valid tag: allowed characters and at least one character that is not a number. */
export function isTag(text: string): boolean {
	if (!TAG_BODY.test(text)) return false;
	if (text.startsWith('/') || text.endsWith('/') || text.includes('//')) return false;
	return /[^\d/]/u.test(text);
}

/** The tags written on one line of text (keys), outside inline code. */
export function lineTags(line: string): string[] {
	const out: string[] = [];
	const re = /(^|\s)#([^\s#]+)/gu;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line)) !== null) {
		const at = m.index + (m[1] ?? '').length;
		if (inInlineCode(line, at)) continue;
		const body = trimTag(m[2] ?? '');
		if (body && isTag(body)) out.push(body.toLowerCase());
	}
	return out;
}

/** Cuts a tag at the first character that Obsidian does not accept (for "#tag," or "#tag."). */
function trimTag(raw: string): string {
	let end = 0;
	for (const ch of raw) {
		if (!TAG_BODY.test(ch)) break;
		end += ch.length;
	}
	return raw.slice(0, end).replace(/\/+$/u, '');
}

/** True when position `at` of the line is inside inline code (an odd number of backtick runs before it). */
function inInlineCode(line: string, at: number): boolean {
	let open: number | null = null;
	let i = 0;
	while (i < at) {
		if (line[i] === '`') {
			let n = 0;
			while (line[i + n] === '`') n++;
			if (open === null) open = n;
			else if (open === n) open = null;
			i += n;
		} else i++;
	}
	return open !== null;
}

/** The result of the trigger check: the anchor key and the column where its "#" starts. */
export interface Trigger {
	anchor: string;
	display: string;
	from: number;
}

/**
 * Checks the text before the cursor on its line. It gives the anchor when the text ends with "#tag" and one space,
 * the "#" is at the line start or after white space, and the "#" is not in inline code. Fast exit for most keys.
 */
export function triggerOnLine(before: string): Trigger | null {
	const n = before.length;
	if (n < 3 || before[n - 1] !== ' ') return null;
	const prev = before[n - 2];
	if (prev === undefined || /\s/u.test(prev)) return null;
	const m = /(^|\s)#([^\s#]+) $/u.exec(before);
	if (!m) return null;
	const body = m[2] ?? '';
	if (!isTag(body)) return null;
	const from = m.index + (m[1] ?? '').length;
	if (inInlineCode(before, from)) return null;
	if (count(before.slice(0, from), '%%') % 2 === 1) return null;
	return { anchor: body.toLowerCase(), display: body, from };
}

/**
 * The last line of the front matter, or -1. Front matter starts with "---" on line 0 and needs a closing "---" or "...";
 * without a closing line, line 0 is a horizontal rule (as in Obsidian). getLine gives line i, or undefined past the end.
 */
export function frontmatterEnd(getLine: (i: number) => string | undefined): number {
	if (getLine(0)?.trimEnd() !== '---') return -1;
	for (let i = 1; ; i++) {
		const l = getLine(i);
		if (l === undefined) return -1;
		const t = l.trimEnd();
		if (t === '---' || t === '...') return i;
	}
}

const FENCE_OPEN = /^\s{0,3}(?:[>-]\s*)*(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^\s{0,3}(?:>\s*)*(`{3,}|~{3,})\s*$/u;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/u;

/** True when the line is a list item or a task item ("- ", "* ", "+ ", "1. ", "1) ", with or without indent). */
export function isListItem(line: string): boolean {
	return LIST_ITEM.test(line);
}

/** Number of times `mark` occurs in the line. */
function count(line: string, mark: string): number {
	let n = 0;
	for (let i = line.indexOf(mark); i !== -1; i = line.indexOf(mark, i + mark.length)) n++;
	return n;
}

/**
 * True when line `line` of the note is in front matter, a fenced code block, an indented code block, a "$$" math block
 * or a "%%" comment block. getLine gives line i. fmEnd is the last front matter line (from the metadata cache), or -1.
 */
export function inBlockContext(getLine: (i: number) => string, line: number, fmEnd: number): boolean {
	if (fmEnd >= 0 && line <= fmEnd) return true;
	let fence: string | null = null;
	let math = false;
	let comment = false;
	let prevBlank = true;
	let prevCode = false;
	let inList = false;
	for (let i = fmEnd + 1; i <= line; i++) {
		const l = getLine(i);
		const blank = l.trim() === '';
		// Indented code: 4 spaces or a tab after a blank line (or after code), outside a list.
		const indented = /^(?: {4}|\t)/u.test(l) && !blank;
		const code: boolean = fence === null && !math && !comment && indented && !LIST_ITEM.test(l) && (prevCode || (prevBlank && !inList));
		if (i === line) return fence !== null || math || comment || code;
		if (fence !== null) {
			const m = FENCE_CLOSE.exec(l);
			const mark = m?.[1] ?? '';
			if (m && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
		} else if (math) {
			if (count(l, '$$') % 2 === 1) math = false;
		} else if (comment) {
			if (count(l, '%%') % 2 === 1) comment = false;
		} else if (!code) {
			const m = FENCE_OPEN.exec(l);
			if (m && !(m[1]?.startsWith('`') && (m[2] ?? '').includes('`'))) fence = m[1] ?? null;
			else if (count(l, '$$') % 2 === 1) math = true;
			else if (count(l, '%%') % 2 === 1) comment = true;
		}
		if (!blank && !code) inList = LIST_ITEM.test(l) || (inList && indented);
		prevCode = code || (prevCode && blank);
		prevBlank = blank;
	}
	return false;
}

/** Same as triggerOnLine, with the front matter and block checks over the whole text. For the golden vectors. */
export function triggerAt(text: string, line: number, ch: number): Trigger | null {
	const lines = text.split('\n');
	const t = triggerOnLine((lines[line] ?? '').slice(0, ch));
	if (!t) return null;
	const fm = frontmatterEnd((i) => lines[i]);
	return inBlockContext((i) => lines[i] ?? '', line, fm) ? null : t;
}

/**
 * Tag pair index. For each note it keeps the tags; for each anchor (a tag or a parent of a nested tag) it keeps the
 * count of each other tag in the same notes. Updates touch only the changed note.
 */
export class PairIndex {
	private notes = new Map<string, string[]>();
	/** Anchor key (tag or parent) to the paths that hold it. */
	private anchorNotes = new Map<string, Set<string>>();
	/** Anchor key to candidate key to count of shared notes. */
	private co = new Map<string, Map<string, number>>();
	/** Tag key to the number of notes that write it. */
	private totals = new Map<string, number>();
	/** Tag key to each casing and its count. */
	private casings = new Map<string, Map<string, number>>();

	get size(): number {
		return this.notes.size;
	}

	clear(): void {
		this.notes.clear();
		this.anchorNotes.clear();
		this.co.clear();
		this.totals.clear();
		this.casings.clear();
	}

	/** The tag keys of a note, or an empty list. */
	tagsOf(path: string): string[] {
		return this.notes.get(path)?.map(tagKey) ?? [];
	}

	/** Sets the tags of a note (with or without "#", any case). It replaces the old tags of that note. */
	set(path: string, tags: readonly string[] | null | undefined): void {
		this.remove(path);
		const seen = new Map<string, string>();
		for (const raw of tags ?? []) {
			const display = raw.startsWith('#') ? raw.slice(1) : raw;
			if (!display) continue;
			const key = display.toLowerCase();
			if (!seen.has(key)) seen.set(key, display);
		}
		if (seen.size === 0) return;
		const displays = [...seen.values()];
		this.notes.set(path, displays);
		this.apply(path, displays, 1);
	}

	/** Removes a note from the index. */
	remove(path: string): void {
		const old = this.notes.get(path);
		if (!old) return;
		this.notes.delete(path);
		this.apply(path, old, -1);
	}

	/** Moves a note to a new path. A folder rename calls this with the folder paths: each note under it moves. */
	rename(oldPath: string, newPath: string): void {
		if (oldPath === newPath) return;
		const tags = this.notes.get(oldPath);
		if (tags) {
			this.remove(oldPath);
			this.set(newPath, tags);
			return;
		}
		const prefix = oldPath + '/';
		const moved = [...this.notes.keys()].filter((p) => p.startsWith(prefix));
		for (const p of moved) this.rename(p, newPath + '/' + p.slice(prefix.length));
	}

	private apply(path: string, displays: string[], sign: 1 | -1): void {
		const keys = displays.map((d) => d.toLowerCase());
		const anchors = new Set<string>();
		for (const k of keys) {
			anchors.add(k);
			for (const a of ancestors(k)) anchors.add(a);
		}
		for (const a of anchors) {
			let set = this.anchorNotes.get(a);
			if (sign > 0) {
				if (!set) this.anchorNotes.set(a, (set = new Set<string>()));
				set.add(path);
			} else if (set) {
				set.delete(path);
				if (set.size === 0) this.anchorNotes.delete(a);
			}
			let row = this.co.get(a);
			for (const k of keys) {
				if (k === a) continue;
				if (sign > 0) {
					if (!row) this.co.set(a, (row = new Map<string, number>()));
					row.set(k, (row.get(k) ?? 0) + 1);
				} else if (row) {
					const v = (row.get(k) ?? 0) - 1;
					if (v > 0) row.set(k, v);
					else row.delete(k);
				}
			}
			if (row && row.size === 0) this.co.delete(a);
		}
		displays.forEach((d, i) => {
			const k = keys[i] ?? d.toLowerCase();
			const t = (this.totals.get(k) ?? 0) + sign;
			if (t > 0) this.totals.set(k, t);
			else this.totals.delete(k);
			let c = this.casings.get(k);
			if (sign > 0) {
				if (!c) this.casings.set(k, (c = new Map<string, number>()));
				c.set(d, (c.get(d) ?? 0) + 1);
			} else if (c) {
				const v = (c.get(d) ?? 0) - 1;
				if (v > 0) c.set(d, v);
				else c.delete(d);
				if (c.size === 0) this.casings.delete(k);
			}
		});
	}

	/** The casing of a tag key that most notes use (ties: the first in code point order). */
	display(key: string): string {
		const c = this.casings.get(key);
		if (!c) return key;
		let best = key;
		let n = -1;
		for (const [d, v] of c) if (v > n || (v === n && d < best)) [best, n] = [d, v];
		return best;
	}

	/** Counts of candidate tags for an anchor, from the pair table or (with a scope) from the notes in scope. */
	private counts(anchor: string, scope: ((path: string) => boolean) | null | undefined): Map<string, number> {
		if (!scope) return this.co.get(anchor) ?? new Map<string, number>();
		const out = new Map<string, number>();
		for (const p of this.anchorNotes.get(anchor) ?? []) {
			if (!scope(p)) continue;
			for (const k of this.tagsOf(p)) if (k !== anchor) out.set(k, (out.get(k) ?? 0) + 1);
		}
		return out;
	}

	/** The tags that occur with the anchor, best first. Rule 4 of the spec gives the order. */
	rank(anchorTag: string, opts: RankOptions = {}): Pairing[] {
		const anchor = tagKey(anchorTag);
		const skip = new Set<string>([anchor, ...ancestors(anchor)]);
		for (const e of opts.exclude ?? []) skip.add(tagKey(e));
		const linkedCount = new Map<string, number>();
		for (const p of opts.linked ?? []) for (const k of this.tagsOf(p)) linkedCount.set(k, (linkedCount.get(k) ?? 0) + 1);
		const rows: { tag: string; count: number; linked: number; total: number }[] = [];
		for (const [k, count] of this.counts(anchor, opts.scope)) {
			if (count <= 0 || skip.has(k)) continue;
			rows.push({ tag: k, count, linked: linkedCount.get(k) ?? 0, total: this.totals.get(k) ?? 0 });
		}
		rows.sort((a, b) => b.count - a.count || b.linked - a.linked || b.total - a.total || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
		const limit = opts.limit ?? 20;
		return rows.slice(0, Math.max(0, limit)).map((r) => ({ tag: r.tag, display: this.display(r.tag), count: r.count }));
	}
}

/** Builds an index from a map of note path to tags and ranks one anchor. For the golden vectors. */
export function rankPairs(notes: Record<string, string[]>, anchor: string, exclude: string[] = [], linked: string[] = [], limit = 20, folder: string | null = null): Pairing[] {
	const index = new PairIndex();
	for (const [p, tags] of Object.entries(notes)) index.set(p, tags);
	const scope = folder === null ? null : (p: string) => folder === '' || p.startsWith(folder + '/');
	return index.rank(anchor, { exclude, linked, limit, scope });
}
