import { App, FuzzySuggestModal, Modal, Setting, TFile } from 'obsidian';
import SuperAddPlugin from '../../main';

/**
 * Modal for selecting a template file for task creation
 */
export class TemplateSelectionModal extends Modal {
    plugin: SuperAddPlugin;
    templateName: string = '';
    selectedTemplate: TFile | null = null;

    constructor(app: App, plugin: SuperAddPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('template-selection-modal');

        contentEl.createEl('h2', { text: 'Select Template' });

        // Template name input
        new Setting(contentEl)
            .setName('Template Name')
            .setDesc('Enter a name for this template')
            .addText(text => text
                .setPlaceholder('Template name')
                .onChange(value => {
                    this.templateName = value;
                }));

        // Template file selection
        new Setting(contentEl)
            .setName('Template File')
            .setDesc('Select a file to use as a template')
            .addButton(button => button
                .setButtonText('Select File')
                .setCta()
                .onClick(() => {
                    const fileSelector = new TemplateFileSelectorModal(this.app);
                    fileSelector.onChooseItem = (file: TFile) => {
                        this.selectedTemplate = file;
                        this.saveTemplate();
                    };
                    fileSelector.open();
                }));

        // Cancel button
        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    saveTemplate() {
        if (this.selectedTemplate) {
            const templateName = this.templateName || this.selectedTemplate.basename;
            this.plugin.settings.templates.push({
                name: templateName,
                path: this.selectedTemplate.path,
                fields: {}
            });
            this.plugin.saveSettings();
            this.close();
        }
    }
}

/**
 * Modal for selecting a file to use as a template
 */
class TemplateFileSelectorModal extends FuzzySuggestModal<TFile> {
    constructor(app: App) {
        super(app);
        this.setPlaceholder('Select a file to use as a template');
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
        // This will be overridden by the parent modal
    }
}