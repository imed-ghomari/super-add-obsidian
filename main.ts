import { Notice, Plugin } from 'obsidian';
import { SuperAddSettings, DEFAULT_SETTINGS } from './src/settings';
import { SuperAddSettingsTab } from './src/settings/SettingsTab';
import { TaskCreationModal, TaskCreationOptions } from './src/modals/TaskCreationModal';
import { NaturalLanguageParser } from './src/services/NaturalLanguageParser';

export default class SuperAddPlugin extends Plugin {
	settings: SuperAddSettings;
	naturalLanguageParser: NaturalLanguageParser;

	async onload() {
		await this.loadSettings();

		// Initialize natural language parser
		this.naturalLanguageParser = new NaturalLanguageParser(this.settings);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SuperAddSettingsTab(this.app, this));

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'create-task',
			name: 'Create Task',
			callback: () => {
				this.openTaskCreationModal();
			}
		});

		// This adds a ribbon icon to the left ribbon
		this.addRibbonIcon('plus', 'Create Task', (evt: MouseEvent) => {
			this.openTaskCreationModal();
		});
	}

	onunload() {
		// Clean up any resources if needed
	}

	async loadSettings() {
		const data = await this.loadData() as Partial<SuperAddSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize parser with new settings
		this.naturalLanguageParser = new NaturalLanguageParser(this.settings);
	}

	/**
	 * Opens the task creation modal with optional parameters.
	 */
	openTaskCreationModal(options: TaskCreationOptions = {}) {
		// Set default options
		const defaultOptions: TaskCreationOptions = {
			folder: this.settings.defaultFolder
		};

		// Merge with provided options
		const mergedOptions = { ...defaultOptions, ...options };

		// Open the modal
		const modal = new TaskCreationModal(this.app, this, mergedOptions);
		modal.open();
	}

	/**
	 * Shows a notice to the user.
	 */
	showNotice(message: string, isError: boolean = false) {
		if (isError) {
			console.error(message);
		}
		new Notice(message);
	}
}
