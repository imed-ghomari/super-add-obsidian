import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import SuperAddPlugin from '../../main';
import { CustomField, Template } from '../settings';
import { CustomFieldModal } from '../modals/CustomFieldModal';

class TemplateSelectionModal extends FuzzySuggestModal<TFile> {
    plugin: SuperAddPlugin;
    settingsTab: SuperAddSettingsTab;

    constructor(app: App, plugin: SuperAddPlugin, settingsTab: SuperAddSettingsTab) {
        super(app);
        this.plugin = plugin;
        this.settingsTab = settingsTab;
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
        const newTemplate: Template = {
            name: file.basename,
            path: file.path,
            fields: {}
        };

        this.plugin.settings.templates.push(newTemplate);
        void (async () => {
            await this.plugin.saveSettings();
            this.settingsTab.display();
        })();
    }
}

export class SuperAddSettingsTab extends PluginSettingTab {
    plugin: SuperAddPlugin;

    constructor(app: App, plugin: SuperAddPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Super Add')
            .setHeading();

        this.createCustomFieldSettings(containerEl);
        this.createTaskManagementPropertiesSettings(containerEl);
        this.createTemplateSettings(containerEl);
    }

    private createCustomFieldSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Properties')
            .setHeading();

        containerEl.createEl('p', {
            text: 'Define properties recognized from natural language and written to frontmatter. Supports string, number, boolean, array, date, and datetime. Values parsed in the modal override template defaults.',
            cls: 'setting-item-description'
        });

        const customFieldsContainer = containerEl.createDiv('custom-fields-container');

        const refreshCustomFields = () => {
            customFieldsContainer.empty();

            if (this.plugin.settings.customFields.length === 0) {
                customFieldsContainer.createEl('p', { text: 'No properties defined yet.', cls: 'no-fields-message' });
                return;
            }

            for (let i = 0; i < this.plugin.settings.customFields.length; i++) {
                const field = this.plugin.settings.customFields[i];
                const fieldEl = customFieldsContainer.createDiv('custom-field-item');
                const defaultLabel = field.defaultValue ? ` (Default: ${field.defaultValue})` : '';
                const defaultFlag = field.isDefault ? ' (Default)' : '';

                new Setting(fieldEl)
                    .setName(field.name + defaultFlag)
                    .setDesc(`Type: ${field.type}${defaultLabel}`)
                    .addExtraButton(button => button
                        .setIcon('pencil')
                        .setTooltip('Edit field')
                        .onClick(() => {
                            this.showCustomFieldModal(field, refreshCustomFields);
                        }))
                    .addExtraButton(button => button
                        .setIcon('trash')
                        .setTooltip('Delete field')
                        .onClick(() => {
                            void (async () => {
                                this.plugin.settings.customFields.splice(i, 1);
                                await this.plugin.saveSettings();
                                refreshCustomFields();
                            })();
                        }));
            }
        };

        refreshCustomFields();

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add Property')
                .setCta()
                .onClick(() => {
                    this.showCustomFieldModal(null, refreshCustomFields);
                }));
    }

    private showCustomFieldModal(initialField: CustomField | null, refresh: () => void): void {
        new CustomFieldModal(this.app, this.plugin, initialField, refresh).open();
    }

    private createTaskManagementPropertiesSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Task Management Properties')
            .setHeading();

        containerEl.createEl('p', {
            text: 'Configure built-in properties for task management. These properties are recognized automatically in natural language input.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Enable Task Management Properties')
            .setDesc('Enable automatic recognition of due dates and recurrence patterns in natural language input')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.taskManagementProperties.enabled)
                .onChange(value => {
                    void (async () => {
                        this.plugin.settings.taskManagementProperties.enabled = value;
                        await this.plugin.saveSettings();
                        this.display();
                    })();
                }));

        if (this.plugin.settings.taskManagementProperties.enabled) {
            new Setting(containerEl)
                .setName('Due Property Name')
                .setDesc('The name of the property used for due dates (for example "due" or "deadline")')
                .addText(text => text
                    .setPlaceholder('due')
                    .setValue(this.plugin.settings.taskManagementProperties.duePropertyName)
                    .onChange(value => {
                        void (async () => {
                            if (!this.validatePropertyName(value, 'due')) {
                                return;
                            }

                            this.plugin.settings.taskManagementProperties.duePropertyName = value;
                            await this.plugin.saveSettings();
                        })();
                    }));

            new Setting(containerEl)
                .setName('Recurrence Property Name')
                .setDesc('The name of the property used for recurrence rules (for example "recurrence" or "repeat")')
                .addText(text => text
                    .setPlaceholder('recurrence')
                    .setValue(this.plugin.settings.taskManagementProperties.recurrencePropertyName)
                    .onChange(value => {
                        void (async () => {
                            if (!this.validatePropertyName(value, 'recurrence')) {
                                return;
                            }

                            this.plugin.settings.taskManagementProperties.recurrencePropertyName = value;
                            await this.plugin.saveSettings();
                        })();
                    }));
        }
    }

    private validatePropertyName(name: string, type: 'due' | 'recurrence'): boolean {
        if (!name || name.trim() === '') {
            return false;
        }

        const isDuplicate = this.plugin.settings.customFields.some(field =>
            field.name.toLowerCase() === name.toLowerCase()
        );

        if (isDuplicate) {
            new Notice(`Property name "${name}" is already used in custom properties. Please choose a different name.`);
            return false;
        }

        const otherPropertyName = type === 'due'
            ? this.plugin.settings.taskManagementProperties.recurrencePropertyName
            : this.plugin.settings.taskManagementProperties.duePropertyName;

        if (name.toLowerCase() === otherPropertyName.toLowerCase()) {
            new Notice(`Property name "${name}" is already used for the other task management property. Please choose a different name.`);
            return false;
        }

        return true;
    }

    private createTemplateSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Templates')
            .setHeading();

        containerEl.createEl('p', {
            text: 'Templates are markdown files with frontmatter. All template keys are written to new notes in the same order, and parsed values from the modal override template values.'
        });

        this.plugin.settings.templates.forEach((template, index) => {
            new Setting(containerEl)
                .setName(template.name)
                .setDesc(template.path)
                .addButton(button => button
                    .setIcon('trash')
                    .setTooltip('Delete template')
                    .onClick(() => {
                        void (async () => {
                            this.plugin.settings.templates.splice(index, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        })();
                    }));
        });

        new Setting(containerEl)
            .setName('Add Template')
            .setDesc('Add a new template for task creation')
            .addButton(button => button
                .setButtonText('Add Template')
                .setCta()
                .onClick(() => {
                    this.addTemplate();
                }));
    }

    private addTemplate(): void {
        new TemplateSelectionModal(this.app, this.plugin, this).open();
    }
}
