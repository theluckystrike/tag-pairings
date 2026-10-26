import { describe, expect, it } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TagPairingsPlugin from '../src/main';
import { DEFAULT_SETTINGS, FREE_LIMIT, effectiveOptions, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

describe('TagPairingsPlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new TagPairingsPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ showCounts: 'yes' as never, folderScope: 1 as never, limit: 'many' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ limit: 500 }).limit).toBe(50);
		expect(normalizeSettings({ limit: 1 }).limit).toBe(5);
	});

	it('keeps the Pro options off without Pro', () => {
		const saved = { showCounts: true, folderScope: true, limit: 40 };
		expect(effectiveOptions(saved, false)).toEqual({ showCounts: false, folderScope: false, limit: FREE_LIMIT });
		expect(effectiveOptions(saved, true)).toEqual({ showCounts: true, folderScope: true, limit: 40 });
	});
});
