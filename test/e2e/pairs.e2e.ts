import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';

// Real-app checks for acceptance criteria 8 to 12 of the spec, on minAppVersion and on the latest app (wdio.conf.mts).
const NOTES: Record<string, string> = {
	'Pairs/A.md': 'Notes on #book #novel and #fiction.\n',
	'Pairs/B.md': '---\ntags: [book, novel]\n---\nBody text.\n',
	'Pairs/C.md': 'Read #book #fiction #Reading\n',
	'Pairs/D.md': '#book #history\n',
	'Pairs/E.md': '#novel #fiction\n',
	'Pairs/F.md': 'Code below.\n\n```\n#book #fakecode\n```\n',
};
const ACTIVE = '.workspace-leaf.mod-active';

interface PluginShape {
	index: { rank(anchor: string, opts?: unknown): { tag: string; display: string; count: number }[]; size: number } | null;
	buildMs: number;
}

/** Writes the notes and waits until the plugin index has the tags of every note. */
async function seed(): Promise<void> {
	for (const [p, t] of Object.entries(NOTES)) await obsidianPage.write(p, t);
	await obsidianPage.write('Host.md', 'Start\n');
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id];
				const r = p?.index?.rank('book') ?? [];
				return r.map((x) => x.tag + String(x.count)).join(',') === 'fiction2,novel2,history1,reading1';
			}, pluginId),
		{ timeout: 15000, interval: 100, timeoutMsg: 'the index did not get the tags of the notes' },
	);
}

async function focusWindow(): Promise<void> {
	await browser.execute(() => {
		try {
			const req = (window as unknown as { require: (m: string) => { app?: { focus(o?: unknown): void }; getCurrentWindow(): { focus(): void; show(): void } } }).require;
			const remote = req('@electron/remote');
			remote.app?.focus({ steal: true });
			remote.getCurrentWindow().show();
			remote.getCurrentWindow().focus();
		} catch {
			window.focus();
		}
	});
}

/** Opens Host.md with the given text, in Live Preview (source false) or Source mode (source true), cursor at the end. */
async function openHost(text: string, source: boolean): Promise<void> {
	// No file write here: a write from outside reloads the open editor some time later and can drop typed keys.
	await obsidianPage.openFile('Host.md');
	await browser.executeObsidian(async ({ app }, src) => {
		const leaf = app.workspace.getMostRecentLeaf();
		if (!leaf) return;
		const s = leaf.getViewState();
		await leaf.setViewState({ ...s, state: { ...s.state, mode: 'source', source: src } });
	}, source);
	await focusWindow();
	await browser.$(`${ACTIVE} .markdown-source-view .cm-content`).click();
	await browser.executeObsidian(({ app }, t) => {
		const e = app.workspace.activeEditor?.editor;
		if (!e) return;
		if (e.getValue() !== t) e.setValue(t);
		e.focus();
		const last = e.lastLine();
		e.setCursor({ line: last, ch: e.getLine(last).length });
	}, text);
	await browser.keys('Escape');
}

/** The texts of the items of the Tag Pairings box, or [] when it is not open. */
async function items(): Promise<string[]> {
	return browser.execute(() => Array.from(document.querySelectorAll('.suggestion-container .tag-pairings-item .tag-pairings-tag')).map((e) => e.textContent ?? ''));
}

async function waitItems(want: string[]): Promise<void> {
	let last: string[] = [];
	await browser
		.waitUntil(
			async () => {
				last = await items();
				return JSON.stringify(last) === JSON.stringify(want);
			},
			{ timeout: 5000, interval: 50 },
		)
		.catch(() => {
			throw new Error(`box items are ${JSON.stringify(last)}, not ${JSON.stringify(want)}`);
		});
}

async function lastLine(): Promise<string> {
	return browser.executeObsidian(({ app }) => {
		const e = app.workspace.activeEditor?.editor;
		return e ? e.getLine(e.lastLine()) : '';
	});
}

/** Sets the host note back to "Start" and waits until the index has the seed rank again (the host note counts too). */
async function resetHost(): Promise<void> {
	await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.setValue('Start\n'));
	await browser.waitUntil(
		async () =>
			browser.executeObsidian(({ app }, id) => {
				const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id];
				const r = p?.index?.rank('book') ?? [];
				return r.map((x) => x.tag + String(x.count)).join(',') === 'fiction2,novel2,history1,reading1';
			}, pluginId),
		{ timeout: 15000, interval: 100, timeoutMsg: 'the index did not go back to the seed rank' },
	);
}

async function typeText(text: string): Promise<void> {
	for (const ch of text) await browser.keys(ch);
}

describe('Tag Pairings in the real app', function () {
	// The suite drives real key presses on a shared CI runner. A test that fails runs again up to 2 times. Each test sets
	// the host note text first, so a run again starts from the same state.
	this.retries(2);

	before(async function () {
		await seed();
	});

	it('criterion 8: Live Preview, "#book " opens the box in rank order; Down then Enter inserts "#novel " and the box opens again', async function () {
		await openHost('Start\nRead ', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		// Up or Down is the opt in: after it, Enter adds the highlighted tag.
		await browser.keys('ArrowDown');
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await lastLine()) === 'Read #book #novel ', { timeout: 5000, timeoutMsg: 'Enter after Down did not add the tag' });
		// The anchor is now novel; book is on the line, so fiction remains.
		await waitItems(['#fiction']);
		// Shift+Enter adds the highlighted tag without a move.
		await browser.keys(['Shift', 'Enter']);
		await browser.waitUntil(async () => (await lastLine()) === 'Read #book #novel #fiction ', { timeout: 5000, timeoutMsg: 'Shift+Enter did not add the tag' });
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue());
		expect(text).toBe('Start\nRead #book #novel #fiction ');
	});

	it('criterion 8: Tab adds the highlighted tag', async function () {
		await openHost('Start\n', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys('Tab');
		await browser.waitUntil(async () => (await lastLine()) === '#book #fiction ', { timeout: 5000, timeoutMsg: 'Tab did not add the tag' });
	});

	it('Enter without a move closes the box and makes a new line, and a task list continues', async function () {
		await openHost('Start\n- [ ] call Bob ', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys('Enter');
		await browser.waitUntil(
			async () => (await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue())) === 'Start\n- [ ] call Bob #book \n- [ ] ',
			{ timeout: 5000, timeoutMsg: 'Enter did not make a new task line' },
		);
		await browser.pause(300);
		expect(await items()).toEqual([]);
	});

	it('the capability runs on the platform that it asks for (desktop, or the mobile emulation)', async function () {
		const opts = (browser.requestedCapabilities as { 'wdio:obsidianOptions'?: { emulateMobile?: boolean } })['wdio:obsidianOptions'];
		const mobile = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isMobile);
		console.log(`PLATFORM isMobile ${String(mobile)}`);
		expect(mobile).toBe(opts?.emulateMobile === true);
	});

	it('Tab in a list item without a move closes the box and indents the item, and adds no tag', async function () {
		await openHost('Start\n- first\n- buy milk ', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys('Tab');
		await browser.waitUntil(async () => /^(\t| {2,4})- buy milk #book $/u.test(await lastLine()), {
			timeout: 5000,
			timeoutMsg: 'Tab did not indent the list item',
		});
		const text = await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue() ?? '');
		expect(text.split('\n').slice(0, 2)).toEqual(['Start', '- first']);
		expect(text).not.toContain('#fiction');
		await browser.keys('Escape');
		await resetHost();
	});

	it('Enter without a move in a plain list item makes a new list item', async function () {
		await openHost('Start\n- first\n- buy milk ', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys('Enter');
		let value = '';
		await browser
			.waitUntil(
				async () => {
					value = (await browser.executeObsidian(({ app }) => app.workspace.activeEditor?.editor?.getValue())) ?? '';
					return value === 'Start\n- first\n- buy milk #book \n- ';
				},
				{ timeout: 5000 },
			)
			.catch(() => {
				throw new Error(`Enter did not make a new list item: ${JSON.stringify(value)}`);
			});
		await resetHost();
	});

	it('Tab in a list item after Down adds the highlighted tag', async function () {
		await openHost('Start\n- first\n- buy milk ', false);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys('ArrowDown');
		await browser.keys('Tab');
		await browser.waitUntil(async () => (await lastLine()) === '- buy milk #book #novel ', { timeout: 5000, timeoutMsg: 'Tab after Down did not add the tag' });
		await browser.keys('Escape');
		await resetHost();
	});

	it('criterion 9: Source mode gives the same box', async function () {
		await openHost('Start\n', true);
		await typeText('#book ');
		await waitItems(['#fiction', '#novel', '#history', '#Reading']);
		await browser.keys(['Shift', 'Enter']);
		await browser.waitUntil(async () => (await lastLine()) === '#book #fiction ', { timeout: 5000, timeoutMsg: 'the tag was not inserted in Source mode' });
	});

	it('criterion 10: an unknown tag gives no box', async function () {
		await openHost('Start\n', false);
		await typeText('#nosuchtag ');
		await browser.pause(400);
		expect(await items()).toEqual([]);
		expect(await lastLine()).toBe('#nosuchtag ');
	});

	it('criterion 11: no box inside a fenced code block, and code is not counted', async function () {
		await openHost('Start\n```\n', false);
		await typeText('#book ');
		await browser.pause(400);
		expect(await items()).toEqual([]);
		const ranked = await browser.executeObsidian(({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
			return p.index!.rank('book').map((x) => x.tag);
		}, pluginId);
		expect(ranked).not.toContain('fakecode');
	});

	it('edit after create: a changed note changes the rank', async function () {
		await obsidianPage.write('Pairs/D.md', '#book #history #fiction\n');
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }, id) => {
					const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
					const r = p.index!.rank('book');
					return r[0]?.tag === 'fiction' && r[0]?.count === 3;
				}, pluginId),
			{ timeout: 10000, interval: 100, timeoutMsg: 'the rank did not follow the edit' },
		);
		try {
			await openHost('Start\n', false);
			await typeText('#book ');
			await waitItems(['#fiction', '#novel', '#history', '#Reading']);
			await browser.keys('Escape');
		} finally {
			// Restore D.md also when the test fails, so that a failure does not change the rank in the next tests.
			await obsidianPage.write('Pairs/D.md', '#book #history\n');
			await resetHost();
		}
	});

	it('rename and delete keep the index right', async function () {
		const r = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id]!;
			const f = app.vault.getFileByPath('Pairs/C.md')!;
			await app.fileManager.renameFile(f, 'Pairs/C2.md');
			const afterRename = p.index!.rank('book').map((x) => x.tag);
			const g = app.vault.getFileByPath('Pairs/C2.md')!;
			const text = await app.vault.read(g);
			await app.vault.delete(g);
			for (let i = 0; i < 50 && p.index!.rank('book').some((x) => x.tag === 'reading'); i++) await new Promise((res) => setTimeout(res, 100));
			const afterDelete = p.index!.rank('book').map((x) => x.tag);
			await app.vault.create('Pairs/C.md', text);
			return { afterRename, afterDelete };
		}, pluginId);
		expect(r.afterRename).toEqual(['fiction', 'novel', 'history', 'reading']);
		expect(r.afterDelete).toEqual(['novel', 'fiction', 'history']);
		await seed();
	});

	it('a large note: the trigger check on a 10,000 line note stays fast', async function () {
		const big = Array.from({ length: 10000 }, (_, i) => `Line ${i} with some words and #t${i % 50}x`).join('\n') + '\n#book ';
		await obsidianPage.write('Big.md', big);
		await obsidianPage.openFile('Big.md');
		const ms = await browser.executeObsidian(async ({ app }, id) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, { suggest: { onTrigger(c: unknown, e: unknown, f: unknown): unknown; getSuggestions(c: unknown): unknown[] } }> } }).plugins.plugins[id]!;
			for (let i = 0; i < 50 && (app.workspace.activeEditor?.editor?.lineCount() ?? 0) < 10000; i++) await new Promise((r) => setTimeout(r, 100));
			const e = app.workspace.activeEditor!.editor!;
			const f = app.workspace.getActiveFile()!;
			const last = e.lastLine();
			const t0 = performance.now();
			let hit: unknown = null;
			for (let i = 0; i < 20; i++) hit = p.suggest.onTrigger({ line: last, ch: 6 }, e, f);
			const trigger = (performance.now() - t0) / 20;
			const t1 = performance.now();
			const items = p.suggest.getSuggestions({ ...(hit as object), editor: e, file: f });
			const suggest = performance.now() - t1;
			return { trigger, suggest, hit: hit !== null, n: items.length };
		}, pluginId);
		console.log(`TIMING on 10000 lines onTrigger ${ms.trigger.toFixed(2)} ms, getSuggestions ${ms.suggest.toFixed(2)} ms`);
		expect(ms.hit).toBe(true);
		expect(ms.trigger).toBeLessThan(50);
		expect(ms.suggest).toBeLessThan(100);
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Big.md');
			if (f) await app.vault.delete(f);
		});
	});

	it('criterion 12: unload removes the box; reload logs no errors', async function () {
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { disablePlugin(id: string): Promise<void> } }).plugins.disablePlugin(id);
		}, pluginId);
		await openHost('Start\n', false);
		await typeText('#book ');
		await browser.pause(400);
		expect(await items()).toEqual([]);
		await obsidianPage.write('Pairs/E.md', '#novel #fiction #extra\n');
		await browser.executeObsidian(async ({ app }, id) => {
			await (app as unknown as { plugins: { enablePlugin(id: string): Promise<boolean> } }).plugins.enablePlugin(id);
		}, pluginId);
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }, id) => {
					const p = (app as unknown as { plugins: { plugins: Record<string, PluginShape> } }).plugins.plugins[id];
					return (p?.index?.rank('novel') ?? []).some((x) => x.tag === 'extra');
				}, pluginId),
			{ timeout: 10000, interval: 100, timeoutMsg: 'the rebuilt index has no tag from the edit made while off' },
		);
	});
});
