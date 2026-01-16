import { App, PluginSettingTab, Setting, TFile, FuzzySuggestModal, Notice } from 'obsidian';
import SuperAddPlugin from '../../main';
import { SuperAddSettings, Template, CustomField } from '../settings';
import { CustomFieldModal } from '../modals/CustomFieldModal';

// TemplateSelectionModal is defined in this file, so no import needed

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

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
        const newTemplate: Template = {
            name: file.basename,
            path: file.path,
            fields: {}
        };
        this.plugin.settings.templates.push(newTemplate);
        this.plugin.saveSettings().then(() => {
            this.settingsTab.display();
        });
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

        containerEl.createEl('h2', { text: 'Super Add Settings' });

        this.createCustomFieldSettings(containerEl);
        this.createTaskManagementPropertiesSettings(containerEl);
        this.createTemplateSettings(containerEl);
    }




    private createCustomFieldSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Properties' });
        containerEl.createEl('p', { 
            text: 'Define properties recognized from natural language and written to frontmatter. Supports string, number, boolean, array, date, and datetime. Values parsed in the modal override template defaults.',
            cls: 'setting-item-description'
        });

        const customFieldsContainer = containerEl.createDiv('custom-fields-container');

        const refreshCustomFields = () => {
            customFieldsContainer.empty();
            
            if (this.plugin.settings.customFields.length === 0) {
                customFieldsContainer.createEl('p', { text: 'No properties defined yet.', cls: 'no-fields-message' });
            } else {
                for (let i = 0; i < this.plugin.settings.customFields.length; i++) {
                    const field = this.plugin.settings.customFields[i];
                    const fieldEl = customFieldsContainer.createDiv('custom-field-item');
                    
                    const fieldName = field.name;
                    const fieldType = field.type;
                    const isDefault = field.isDefault ? ' (Default)' : '';
                    const defaultValue = field.defaultValue ? ` (Default: ${field.defaultValue})` : '';
                    
                    new Setting(fieldEl)
                        .setName(fieldName + isDefault)
                        .setDesc(`Type: ${fieldType}${defaultValue}`)
                        .addExtraButton(button => button
                            .setIcon('pencil')
                            .setTooltip('Edit field')
                            .onClick(() => {
                                this.showCustomFieldModal(field, refreshCustomFields);
                            }))
                        .addExtraButton(button => button
                            .setIcon('trash')
                            .setTooltip('Delete field')
                            .onClick(async () => {
                                this.plugin.settings.customFields.splice(i, 1);
                                await this.plugin.saveSettings();
                                refreshCustomFields();
                            }));
                }
            }
        };

        refreshCustomFields();
        
        // Add button to create a new custom field
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add Property')
                .setCta()
                .onClick(() => {
                    this.showCustomFieldModal(null, refreshCustomFields);
                }));
    }

    private showCustomFieldModal(initialField: CustomField | null, refresh: () => void): void {
        const { app, plugin } = this;
        new CustomFieldModal(app, plugin, initialField, refresh).open();
    }

    private createTaskManagementPropertiesSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Task Management Properties' });
        containerEl.createEl('p', { 
            text: 'Configure built-in properties for task management. These properties are recognized automatically in natural language input.',
            cls: 'setting-item-description'
        });

        // Enable/disable toggle
        new Setting(containerEl)
            .setName('Enable Task Management Properties')
            .setDesc('Enable automatic recognition of due dates and recurrence patterns in natural language input')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.taskManagementProperties.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.taskManagementProperties.enabled = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide property name fields
                }));

        // Property name fields (only shown when enabled)
        if (this.plugin.settings.taskManagementProperties.enabled) {
            // Due property name
            new Setting(containerEl)
                .setName('Due Property Name')
                .setDesc('The name of the property used for due dates (e.g., "due", "deadline")')
                .addText(text => text
                    .setPlaceholder('due')
                    .setValue(this.plugin.settings.taskManagementProperties.duePropertyName)
                    .onChange(async (value) => {
                        if (this.validatePropertyName(value, 'due')) {
                            this.plugin.settings.taskManagementProperties.duePropertyName = value;
                            await this.plugin.saveSettings();
                        }
                    }));

            // Recurrence property name
            new Setting(containerEl)
                .setName('Recurrence Property Name')
                .setDesc('The name of the property used for recurrence rules (e.g., "recurrence", "repeat")')
                .addText(text => text
                    .setPlaceholder('recurrence')
                    .setValue(this.plugin.settings.taskManagementProperties.recurrencePropertyName)
                    .onChange(async (value) => {
                        if (this.validatePropertyName(value, 'recurrence')) {
                            this.plugin.settings.taskManagementProperties.recurrencePropertyName = value;
                            await this.plugin.saveSettings();
                        }
                    }));
        }
    }

    private validatePropertyName(name: string, type: 'due' | 'recurrence'): boolean {
        if (!name || name.trim() === '') {
            return false;
        }

        // Check for duplicates with custom fields
        const isDuplicate = this.plugin.settings.customFields.some(field => 
            field.name.toLowerCase() === name.toLowerCase()
        );

        if (isDuplicate) {
            new Notice(`Property name "${name}" is already used in custom properties. Please choose a different name.`);
            return false;
        }

        // Check for duplicates between due and recurrence
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
        containerEl.createEl('h3', { text: 'Templates' });
        containerEl.createEl('p', { text: 'Templates are markdown files with frontmatter. All template keys are written to new notes in the same order; unfilled keys are written as empty (key:). Parsed values from the modal override template values.' });

        // Display existing templates
        this.plugin.settings.templates.forEach((template: Template, index: number) => {
            const templateSetting = new Setting(containerEl)
                .setName(template.name)
                .setDesc(template.path)
                .addButton(button => button
                    .setIcon('trash')
                    .setTooltip('Delete template')
                    .onClick(async () => {
                        this.plugin.settings.templates.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        });

        // Add new template
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
        const modal = new TemplateSelectionModal(this.app, this.plugin, this);
        modal.open();
}

    }