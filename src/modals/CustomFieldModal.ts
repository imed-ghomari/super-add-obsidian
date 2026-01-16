import { App, Modal, Setting, Notice } from 'obsidian';
import SuperAddPlugin from '../../main';
import { CustomField } from '../settings';

export class CustomFieldModal extends Modal {
    plugin: SuperAddPlugin;
    initialField: CustomField | null;
    refresh: () => void;

    constructor(app: App, plugin: SuperAddPlugin, initialField: CustomField | null, refresh: () => void) {
        super(app);
        this.plugin = plugin;
        this.initialField = initialField;
        this.refresh = refresh;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        let fieldName = this.initialField ? this.initialField.name : '';
        let fieldType = this.initialField ? this.initialField.type : 'string';
        let defaultValue = this.initialField ? this.initialField.defaultValue : '';
        let useRegex = this.initialField ? this.initialField.useRegex || false : false;

        contentEl.createEl('h2', { text: this.initialField ? 'Edit Property' : 'Add Property' });

        new Setting(contentEl)
            .setName('Property Name')
            .addText(text => text
                .setValue(fieldName)
                .onChange(value => {
                    fieldName = value;
                }));

        // Create a container for dynamic content
        const dynamicContent = contentEl.createDiv('dynamic-content');

        const updateDynamicContent = () => {
            dynamicContent.empty();
            
            // Show defined values field only for string and array types
            if (fieldType === 'string' || fieldType === 'array') {
                new Setting(dynamicContent)
                    .setName('Defined Values (comma-separated)')
                    .setDesc('For text properties: recognized by value only. For list properties: allows multiple values.')
                    .addText(text => text
                        .setValue(defaultValue)
                        .onChange(value => {
                            defaultValue = value;
                        }));
                
                new Setting(dynamicContent)
                    .setName('Use Regex')
                    .setDesc('Enable regex pattern matching for defined values')
                    .addToggle(toggle => toggle
                        .setValue(useRegex)
                        .onChange(value => {
                            useRegex = value;
                        }));
            }
        };

        new Setting(contentEl)
            .setName('Property Type')
            .addDropdown(dropdown => dropdown
                .addOption('string', 'Text')
                .addOption('date', 'Date')
                .addOption('datetime', 'Date & Time')
                .addOption('number', 'Number')
                .addOption('boolean', 'Checkbox')
                .addOption('array', 'Tags/List')
                .setValue(fieldType)
                .onChange(value => {
                    fieldType = value as 'string' | 'date' | 'datetime' | 'number' | 'boolean' | 'array';
                    updateDynamicContent();
                }));

        // Initialize dynamic content
        updateDynamicContent();

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(this.initialField ? 'Save Property' : 'Add Property')
                .setCta()
                .onClick(async () => {
                    if (!fieldName) {
                        new Notice('Property name is required');
                        return;
                    }

                    // Validate property name
                    if (!this.validatePropertyName(fieldName)) {
                        return;
                    }

                    const newField: CustomField = {
                        name: fieldName,
                        type: fieldType,
                        defaultValue: defaultValue,
                        useRegex: useRegex
                    };

                    if (this.initialField) {
                        // Update existing field
                        const index = this.plugin.settings.customFields.findIndex(f => f.name === this.initialField?.name);
                        if (index !== -1) {
                            this.plugin.settings.customFields[index] = newField;
                        }
                    } else {
                        // Add new field
                        this.plugin.settings.customFields.push(newField);
                    }

                    await this.plugin.saveSettings();
                    this.refresh();
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private validatePropertyName(name: string): boolean {
        if (!name || name.trim() === '') {
            return false;
        }

        // Check for duplicates with other custom fields (excluding current field if editing)
        const isDuplicate = this.plugin.settings.customFields.some(field => 
            field.name.toLowerCase() === name.toLowerCase() && 
            (!this.initialField || field.name !== this.initialField.name)
        );

        if (isDuplicate) {
            new Notice(`Property name "${name}" is already used. Please choose a different name.`);
            return false;
        }

        // Check for duplicates with task management properties
        if (this.plugin.settings.taskManagementProperties.enabled) {
            const duePropertyName = this.plugin.settings.taskManagementProperties.duePropertyName;
            const recurrencePropertyName = this.plugin.settings.taskManagementProperties.recurrencePropertyName;

            if (name.toLowerCase() === duePropertyName.toLowerCase() || 
                name.toLowerCase() === recurrencePropertyName.toLowerCase()) {
                new Notice(`Property name "${name}" is already used for task management properties. Please choose a different name.`);
                return false;
            }
        }

        return true;
    }
}