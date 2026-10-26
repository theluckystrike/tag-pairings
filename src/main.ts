import { Plugin, TFile, getAllTags, type CachedMetadata } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { setupHello } from './hello/index';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, TagPairingsSettingTab, effectiveOptions, normalizeSettings, type TagPairingsSettings } from './settings';
import { PairIndex } from './pairs';
import { PairSuggest } from './suggest';
import WHATS_NEW from './whats-new.json';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;

export default class TagPairingsPlugin extends Plugin {
	settings: TagPairingsSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** The tag pair index. Null until the layout is ready and after unload. */
	index: PairIndex | null = null;
	/** Time of the first index build in ms. */
	buildMs = 0;
	suggest: PairSuggest | null = null;
	private settingTab: TagPairingsSettingTab | null = null;

	async onload(): Promise<void> {
		// First: "What's new" reads its state before the settings load (packages/hello). It does not wait.
		setupHello(this, WHATS_NEW);
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new TagPairingsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.suggest = new PairSuggest(
			this.app,
			() => this.index,
			() => effectiveOptions(this.settings, isPro()),
		);
		this.registerEditorSuggest(this.suggest);

		// Incremental updates: one note at a time. A keystroke never scans the vault.
		this.registerEvent(this.app.metadataCache.on('changed', (file, _data, cache) => this.index?.set(file.path, tagsOf(cache))));
		this.registerEvent(this.app.metadataCache.on('deleted', (file) => this.index?.remove(file.path)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.index?.rename(oldPath, file.path)));

		this.app.workspace.onLayoutReady(() => {
			this.rebuild();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		this.index?.clear();
		this.index = null;
		this.suggest = null;
		resetPro();
	}

	/** Builds the index from the metadata cache of every Markdown note. */
	rebuild(): void {
		const t0 = performance.now();
		const index = new PairIndex();
		for (const file of this.app.vault.getMarkdownFiles()) index.set(file.path, tagsOfFile(this, file));
		this.index = index;
		this.buildMs = performance.now() - t0;
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<TagPairingsSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** The tags of a cache entry: body tags and front matter tags, each one with "#". */
function tagsOf(cache: CachedMetadata | null): string[] {
	return (cache ? getAllTags(cache) : null) ?? [];
}

function tagsOfFile(plugin: Plugin, file: TFile): string[] {
	return tagsOf(plugin.app.metadataCache.getFileCache(file));
}
