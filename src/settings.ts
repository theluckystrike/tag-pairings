import { PluginSettingTab, type Notice, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems, redrawKeepFocus } from './license/github-obsidian';
import { helloSettingItems } from './hello/settings';
import { PRO_LEADS, PRO_UI, isPro, proNotice } from './pro';
import type TagPairingsPlugin from './main';

export interface TagPairingsSettings {
	/** Pro: show the count of shared notes next to each tag. */
	showCounts: boolean;
	/** Pro: count only the notes in the folder of the current note and its subfolders. */
	folderScope: boolean;
	/** Pro: the most tags in the list. Free uses 20. */
	limit: number;
}

export const FREE_LIMIT = 20;
export const MIN_LIMIT = 5;
export const MAX_LIMIT = 50;

export const DEFAULT_SETTINGS: TagPairingsSettings = {
	showCounts: false,
	folderScope: false,
	limit: FREE_LIMIT,
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<TagPairingsSettings> | null | undefined): TagPairingsSettings {
	const s = saved ?? {};
	const limit = typeof s.limit === 'number' && Number.isFinite(s.limit) ? Math.round(s.limit) : DEFAULT_SETTINGS.limit;
	return {
		showCounts: typeof s.showCounts === 'boolean' ? s.showCounts : DEFAULT_SETTINGS.showCounts,
		folderScope: typeof s.folderScope === 'boolean' ? s.folderScope : DEFAULT_SETTINGS.folderScope,
		limit: Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, limit)),
	};
}

export interface Effective {
	showCounts: boolean;
	folderScope: boolean;
	limit: number;
}

/** The settings in effect. Without Pro: no counts, the whole vault, 20 tags. */
export function effectiveOptions(settings: TagPairingsSettings, pro: boolean): Effective {
	return {
		showCounts: pro && settings.showCounts,
		folderScope: pro && settings.folderScope,
		limit: pro ? settings.limit : FREE_LIMIT,
	};
}

export class TagPairingsSettingTab extends PluginSettingTab {
	plugin: TagPairingsPlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: TagPairingsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Show counts',
				desc: 'Pro. Show the number of notes that hold both tags next to each suggested tag.',
				control: { type: 'toggle', key: 'showCounts', defaultValue: DEFAULT_SETTINGS.showCounts },
			},
			{
				name: 'Count only this folder',
				desc: 'Pro. Count only the notes in the folder of the current note and its subfolders. A note at the vault root counts the whole vault.',
				control: { type: 'toggle', key: 'folderScope', defaultValue: DEFAULT_SETTINGS.folderScope },
			},
			{
				name: 'Number of suggestions',
				desc: `Pro. The most tags in the list, from ${MIN_LIMIT} to ${MAX_LIMIT}. The free version shows up to ${FREE_LIMIT}.`,
				control: { type: 'slider', key: 'limit', defaultValue: DEFAULT_SETTINGS.limit, min: MIN_LIMIT, max: MAX_LIMIT, step: 1 },
			},
			{
				name: 'Pro features',
				desc: isPro()
					? 'Pro is on: the three settings above work.'
					: `Free version: type a tag and a space to see up to ${FREE_LIMIT} tags that occur with it in your vault. Pro adds counts, the folder scope and the list length.`,
			},
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}

	/** The last Pro notice of this tab. A second notice does not show while it is open. */
	private notice: Notice | null = null;

	getControlValue(key: string): unknown {
		// A free user sees the values in effect without Pro. The stored choice stays for the time that Pro comes back.
		if (PRO_LEADS[key] !== undefined && !isPro()) return effectiveOptions(this.plugin.settings, false)[key as keyof Effective];
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const lead = PRO_LEADS[key];
		if (lead !== undefined && !isPro()) {
			// A free user selected a Pro setting: tell how to get Pro and save nothing. Move the focus out, then draw the
			// tab again, so the control shows the value in effect (Obsidian does not draw a focused control again).
			if (!this.notice?.messageEl.isConnected) this.notice = proNotice(lead);
			redrawKeepFocus(this);
			return;
		}
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
	}
}
