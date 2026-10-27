import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, PluginSettingTab } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import TagPairingsPlugin from '../src/main';
import { TagPairingsSettingTab } from '../src/settings';
import { PRO_LEADS, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user can select the 3 Pro settings. Each one shows the shared Pro notice with the "Sponsor on GitHub"
// button. Nothing is saved, and the controls show the values in effect without Pro.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'tag-pairings' },
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: {} });
	const plugin = new TagPairingsPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		// A shown notice is in the document until it hides.
		document.body.append(this.messageEl);
	});
	// The Obsidian base setControlValue writes plugin.settings and saves; the mock does not, so record the calls.
	const base = vi.spyOn(PluginSettingTab.prototype, 'setControlValue').mockResolvedValue(undefined);
	const tab = new TagPairingsSettingTab(app as never, plugin);
	const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
	type Def = { control?: { key: string; disabled?: () => boolean } };
	const controls = (tab.getSettingDefinitions() as Def[]).filter((d) => d.control).map((d) => d.control!);
	return { plugin, tab, shown, base, update, controls };
}
const CHANGES: [string, unknown][] = [['showCounts', true], ['folderScope', true], ['limit', 40]];

describe('Pro settings', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who selects a Pro setting gets the Pro notice with a Sponsor button, nothing is saved, and the controls show the values in effect', async () => {
		const { plugin, tab, shown, base, update, controls } = await setup(false);
		// A lapsed sponsor keeps saved Pro values.
		plugin.settings.showCounts = true; plugin.settings.limit = 30;
		const before = JSON.stringify(plugin.settings);
		expect(controls.filter((c) => c.disabled?.())).toEqual([]);
		expect(CHANGES.map(([k]) => tab.getControlValue(k))).toEqual([false, false, 20]);
		for (const [key, value] of CHANGES) { document.body.empty(); await tab.setControlValue(key, value); }
		expect(shown).toEqual(CHANGES.map(([key]) => ({ text: `${PRO_LEADS[key]} ${PITCH}Sponsor on GitHub`, buttons: 1 })));
		expect(update).toHaveBeenCalledTimes(3);
		expect(base).not.toHaveBeenCalled();
		expect(JSON.stringify(plugin.settings)).toBe(before);
		// A slider drag while the notice shows gives no second notice.
		await tab.setControlValue('limit', 41);
		expect(shown.length).toBe(3);
	});

	it('a Pro user who changes the Pro settings saves them, with no Pro notice', async () => {
		const { tab, shown, base } = await setup(true);
		for (const [key, value] of CHANGES) await tab.setControlValue(key, value);
		expect(base.mock.calls).toEqual(CHANGES);
		expect(shown).toEqual([]);
	});
});
