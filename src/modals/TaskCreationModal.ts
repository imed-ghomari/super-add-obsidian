import { App, ButtonComponent, MarkdownRenderer, Modal, Setting, TextAreaComponent, TFile, parseYaml } from 'obsidian';
import SuperAddPlugin from '../../main';
import { FolderSuggestModal } from './FolderSuggestModal';
import { LinkSuggestModal } from './LinkSuggestModal';
import { ParsedTaskData, NaturalLanguageParser } from '../services/NaturalLanguageParser';
import { FrontmatterScalar, FrontmatterValue, Template } from '../settings';

interface TemplaterPlugin {
    templater?: {
        overwrite_file_commands: (file: TFile) => Promise<void>;
    };
}

interface AppWithPlugins extends App {
    plugins?: {
        plugins?: Record<string, TemplaterPlugin | undefined>;
    };
}

type PreviewProperty = {
    key: string;
    value: FrontmatterValue;
    isTemplate: boolean;
};

export interface TaskCreationOptions {
    initialValue?: string;
    folder?: string;
    placeholder?: string;
    enableNLP?: boolean;
    template?: string;
}

export class TaskCreationModal extends Modal {
    private plugin: SuperAddPlugin;
    private nlpParser: NaturalLanguageParser;
    private previewEl!: HTMLElement;
    private parsedData: ParsedTaskData;
    private options: TaskCreationOptions;
    private selectedTemplate: string | null = null;
    private templateData: Record<string, FrontmatterValue> = {};
    private templateFields: string[] = [];
    private inputEl!: TextAreaComponent;

    constructor(app: App, plugin: SuperAddPlugin, options: TaskCreationOptions = {}) {
        super(app);
        this.plugin = plugin;
        this.nlpParser = new NaturalLanguageParser(this.plugin.settings);
        this.options = options;
        this.parsedData = {
            title: '',
            tags: [],
            customFields: {}
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Create Task with Natural Language' });
        this.createNaturalLanguageInput(contentEl);
        this.createPreviewSection(contentEl);
        this.createActionButtons(contentEl);
        contentEl.addClass('super-add-task-modal');
    }

    onClose() {
        this.contentEl.empty();
    }

    private createNaturalLanguageInput(container: HTMLElement) {
        const inputContainer = container.createDiv({ cls: 'super-add-input-container' });
        const setting = new Setting(inputContainer).setName('Task Description');

        this.inputEl = new TextAreaComponent(setting.controlEl);
        this.inputEl.inputEl.addClass('super-add-task-input');
        this.inputEl
            .setPlaceholder(this.options.placeholder ?? 'E.g., Call John about project tomorrow at 3pm -link to file property value...')
            .setValue(this.options.initialValue ?? '')
            .onChange(value => {
                void this.updatePreview(value);
            });

        this.inputEl.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== '-') {
                return;
            }

            const cursorPos = this.inputEl.inputEl.selectionStart;
            const textBefore = this.inputEl.getValue().substring(0, cursorPos);
            const lastChar = textBefore.charAt(textBefore.length - 1);

            if (lastChar === ' ' || lastChar === '' || lastChar === '\n') {
                window.setTimeout(() => {
                    this.openLinkModal();
                }, 10);
            }
        });

        this.inputEl.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void this.createTask();
            }
        });

        window.setTimeout(() => {
            this.inputEl.inputEl.focus();
            void this.updatePreview(this.inputEl.getValue());
        }, 10);
    }

    private createPreviewSection(container: HTMLElement) {
        const previewContainer = container.createDiv({ cls: 'super-add-preview-container' });
        previewContainer.createEl('h3', { text: 'Preview' });
        this.previewEl = previewContainer.createDiv({ cls: 'super-add-preview' });
        this.previewEl.createEl('div', {
            text: 'Enter task description to see preview',
            cls: 'super-add-preview-placeholder'
        });
    }

    private createActionButtons(container: HTMLElement) {
        const buttonContainer = container.createDiv({ cls: 'super-add-button-container' });

        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close();
            });

        new ButtonComponent(buttonContainer)
            .setButtonText('Create Task')
            .setCta()
            .onClick(() => {
                void this.createTask();
            });
    }

    private async loadTemplateData(templateName: string) {
        const template = this.plugin.settings.templates.find((item: Template) => item.name === templateName);
        if (!template) {
            this.templateData = {};
            this.templateFields = [];
            return;
        }

        try {
            const file = this.app.vault.getAbstractFileByPath(template.path);
            if (!(file instanceof TFile)) {
                console.error('Template file not found:', template.path);
                return;
            }

            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch?.[1]) {
                this.templateData = {};
                this.templateFields = [];
                return;
            }

            const parsed = parseYaml(frontmatterMatch[1]);
            this.templateData = this.toFrontmatterRecord(parsed);
            this.templateFields = Object.keys(this.templateData);
        } catch (error: unknown) {
            console.error('Error loading template data:', error);
        }
    }

    private async updatePreview(input: string) {
        if (!input) {
            this.previewEl.empty();
            this.previewEl.createEl('div', {
                text: 'Enter task description to see preview',
                cls: 'super-add-preview-placeholder'
            });
            return;
        }

        this.parsedData = this.nlpParser.parseInput(input);
        this.previewEl.empty();

        const titleEl = this.previewEl.createEl('div', { cls: 'super-add-preview-title' });
        titleEl.createEl('strong', { text: 'Title: ' });
        titleEl.createSpan({ text: this.parsedData.title || '(No title)' });

        if (this.parsedData.details) {
            const detailsEl = this.previewEl.createEl('div', { cls: 'super-add-preview-details' });
            detailsEl.createEl('strong', { text: 'Details: ' });
            const detailsContent = detailsEl.createDiv({ cls: 'super-add-preview-details-content' });
            await MarkdownRenderer.render(this.app, this.parsedData.details, detailsContent, '', this.plugin);
        }

        if (this.parsedData.template && this.parsedData.template !== this.selectedTemplate) {
            this.selectedTemplate = this.parsedData.template;
            await this.loadTemplateData(this.selectedTemplate);
        } else if (!this.parsedData.template) {
            this.selectedTemplate = null;
            this.templateData = {};
            this.templateFields = [];
        }

        this.createUnifiedPreview();
    }

    private createUnifiedPreview() {
        const existingItems = this.previewEl.querySelectorAll('.super-add-preview-item, .super-add-preview-template-field');
        existingItems.forEach(item => item.remove());

        const allProperties: PreviewProperty[] = [];

        if (this.selectedTemplate && this.templateFields.length > 0) {
            const filteredTemplateFields = this.templateFields.filter(field => {
                if (field === 'title') {
                    return false;
                }

                const isCustomField = this.plugin.settings.customFields.some(customField => customField.name === field);
                const isTaskManagementProperty = this.plugin.settings.taskManagementProperties.enabled
                    && (field === this.plugin.settings.taskManagementProperties.duePropertyName
                        || field === this.plugin.settings.taskManagementProperties.recurrencePropertyName);

                return isCustomField || isTaskManagementProperty || field === 'tags';
            });

            if (filteredTemplateFields.length > 0) {
                const templateHeader = this.previewEl.createDiv('super-add-template-header');
                templateHeader.setText(`Template: ${this.selectedTemplate} Properties`);
            }

            for (const field of filteredTemplateFields) {
                const parsedValue = this.parsedData.customFields[field];
                const templateValue = this.templateData[field] ?? null;

                allProperties.push({
                    key: field,
                    value: parsedValue ?? templateValue,
                    isTemplate: true
                });
            }
        }

        for (const [fieldName, fieldValue] of Object.entries(this.parsedData.customFields)) {
            const isInTemplate = allProperties.some(property => property.key === fieldName && property.isTemplate);
            if (!isInTemplate && this.hasValue(fieldValue)) {
                allProperties.push({
                    key: fieldName,
                    value: fieldValue,
                    isTemplate: false
                });
            }
        }

        if (this.plugin.settings.taskManagementProperties.enabled) {
            const duePropertyName = this.plugin.settings.taskManagementProperties.duePropertyName;
            const recurrencePropertyName = this.plugin.settings.taskManagementProperties.recurrencePropertyName;

            if (this.parsedData.dueDate) {
                const existingDueIndex = allProperties.findIndex(property => property.key === duePropertyName);
                if (existingDueIndex !== -1) {
                    allProperties[existingDueIndex].value = this.parsedData.dueDate;
                } else {
                    allProperties.push({
                        key: duePropertyName,
                        value: this.parsedData.dueDate,
                        isTemplate: false
                    });
                }
            }

            if (this.parsedData.recurrence) {
                const existingRecurrenceIndex = allProperties.findIndex(property => property.key === recurrencePropertyName);
                if (existingRecurrenceIndex !== -1) {
                    allProperties[existingRecurrenceIndex].value = this.parsedData.recurrence;
                } else {
                    allProperties.push({
                        key: recurrencePropertyName,
                        value: this.parsedData.recurrence,
                        isTemplate: false
                    });
                }
            }
        }

        if (this.parsedData.tags.length > 0) {
            allProperties.push({
                key: 'tags',
                value: this.parsedData.tags.join(', '),
                isTemplate: false
            });
        }

        const pillContainer = this.previewEl.createDiv('super-add-pill-container');
        for (const property of allProperties) {
            const pill = pillContainer.createDiv('super-add-pill');
            pill.createSpan({ cls: 'property-name', text: `${property.key}:` });
            pill.createSpan({ cls: 'property-value', text: ` ${this.formatFrontmatterValue(property.value)}` });
        }
    }

    private openLinkModal() {
        const linkModal = new LinkSuggestModal(this.app, (file: TFile) => {
            const cursorPos = this.inputEl.inputEl.selectionStart;
            const currentValue = this.inputEl.getValue();
            const beforeCursor = currentValue.substring(0, cursorPos);
            const afterCursor = currentValue.substring(cursorPos);
            const adjustedBeforeCursor = beforeCursor.endsWith('-') ? beforeCursor.slice(0, -1) : beforeCursor;
            const linkText = `[[${file.basename}]]`;
            const newValue = adjustedBeforeCursor + linkText + afterCursor;

            this.inputEl.setValue(newValue);

            const newCursorPos = adjustedBeforeCursor.length + linkText.length;
            window.setTimeout(() => {
                this.inputEl.inputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.inputEl.inputEl.focus();
            }, 10);

            void this.updatePreview(newValue);
        });

        linkModal.open();
    }

    private async createTask() {
        try {
            this.close();

            new FolderSuggestModal(this.app, this.plugin, {
                callback: (folderPath: string) => {
                    void this.createFileInFolder(folderPath);
                },
                initialFolder: this.options.folder || this.plugin.settings.defaultFolder
            }).open();
        } catch (error: unknown) {
            console.error('Error creating task:', error);
            this.plugin.showNotice(`Error creating task: ${this.getErrorMessage(error)}`, true);
        }
    }

    private async createFileInFolder(targetFolder: string) {
        try {
            const frontmatter: Record<string, FrontmatterValue> = {};

            for (const [fieldName, fieldValue] of Object.entries(this.parsedData.customFields)) {
                if (this.hasValue(fieldValue)) {
                    frontmatter[fieldName] = fieldValue;
                }
            }

            if (this.plugin.settings.taskManagementProperties.enabled) {
                const duePropertyName = this.plugin.settings.taskManagementProperties.duePropertyName;
                const recurrencePropertyName = this.plugin.settings.taskManagementProperties.recurrencePropertyName;

                if (this.parsedData.dueDate && !frontmatter[duePropertyName]) {
                    frontmatter[duePropertyName] = this.parsedData.dueDate;
                }

                if (this.parsedData.dueTime) {
                    frontmatter.time = this.parsedData.dueTime;
                }

                if (this.parsedData.recurrence) {
                    frontmatter[recurrencePropertyName] = this.parsedData.recurrence;
                }
            }

            if (this.parsedData.scheduledDate) {
                frontmatter.scheduled = this.parsedData.scheduledDate;
            }

            if (this.parsedData.scheduledTime) {
                frontmatter.scheduledTime = this.parsedData.scheduledTime;
            }

            if (this.parsedData.tags.length > 0) {
                frontmatter.tags = this.parsedData.tags;
            }

            if (this.parsedData.estimate) {
                frontmatter.timeEstimate = this.parsedData.estimate;
            }

            if (this.selectedTemplate && Object.keys(this.templateData).length > 0) {
                for (const [field, value] of Object.entries(this.templateData)) {
                    if (frontmatter[field] === undefined) {
                        frontmatter[field] = this.normalizeTemplateValue(value);
                    }
                }
            }

            const sanitizedTitle = this.sanitizeFilename(this.parsedData.title) || 'Untitled';
            const filename = `${sanitizedTitle}.md`;

            if (!this.app.vault.getAbstractFileByPath(targetFolder)) {
                await this.app.vault.createFolder(targetFolder);
            }

            const orderedFrontmatter = this.orderFrontmatter(frontmatter);
            const yamlFrontmatter = this.generateYamlFrontmatter(orderedFrontmatter);
            const fileContent = `---\n${yamlFrontmatter}---\n\n${this.parsedData.details || ''}`;
            const filePath = `${targetFolder}/${filename}`;
            const file = await this.app.vault.create(filePath, fileContent);

            if (this.selectedTemplate) {
                await this.triggerTemplaterExecution(file);
            }

            await this.app.workspace.getLeaf(true).openFile(file);
        } catch (error: unknown) {
            console.error('Error creating file:', error);
            this.plugin.showNotice(`Error creating file: ${this.getErrorMessage(error)}`, true);
        }
    }

    private sanitizeFilename(input: string): string {
        return input.replace(/[\\/:*?"<>|]/g, '').trim();
    }

    private orderFrontmatter(frontmatter: Record<string, FrontmatterValue>): Record<string, FrontmatterValue> {
        if (!this.selectedTemplate || this.templateFields.length === 0) {
            return frontmatter;
        }

        const orderedFrontmatter: Record<string, FrontmatterValue> = {};
        for (const key of this.templateFields) {
            if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
                orderedFrontmatter[key] = frontmatter[key];
            } else if (Object.prototype.hasOwnProperty.call(this.templateData, key)) {
                orderedFrontmatter[key] = this.normalizeTemplateValue(this.templateData[key]);
            } else {
                orderedFrontmatter[key] = null;
            }
        }

        for (const [key, value] of Object.entries(frontmatter)) {
            if (!this.templateFields.includes(key)) {
                orderedFrontmatter[key] = value;
            }
        }

        return orderedFrontmatter;
    }

    private generateYamlFrontmatter(data: Record<string, FrontmatterValue>): string {
        const lines: string[] = [];

        for (const [key, value] of Object.entries(data)) {
            if (value === undefined) {
                continue;
            }

            if (value === null) {
                lines.push(`${key}: `);
                continue;
            }

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    continue;
                }

                lines.push(`${key}:`);
                for (const item of value) {
                    lines.push(`  - ${this.escapeYamlValue(item)}`);
                }
                continue;
            }

            if (typeof value === 'string' && (value.includes('\n') || value.includes(':') || value.includes('#'))) {
                lines.push(`${key}: |\n  ${value.replace(/\n/g, '\n  ')}`);
                continue;
            }

            lines.push(`${key}: ${this.escapeYamlValue(value)}`);
        }

        return lines.join('\n') + '\n';
    }

    private escapeYamlValue(value: FrontmatterScalar): string {
        if (value === null) {
            return 'null';
        }

        if (typeof value !== 'string') {
            return String(value);
        }

        if (/[:[\]{}\-#,]/.test(value) || /^['"]/.test(value)) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }

        return value;
    }

    private async triggerTemplaterExecution(file: TFile): Promise<void> {
        try {
            const templaterPlugin = (this.app as AppWithPlugins).plugins?.plugins?.['templater-obsidian'];

            if (!templaterPlugin?.templater) {
                console.log('Templater plugin not found or not enabled');
                return;
            }

            await new Promise<void>(resolve => {
                window.setTimeout(resolve, 100);
            });

            await templaterPlugin.templater.overwrite_file_commands(file);
            console.log('Templater execution triggered for file:', file.path);
        } catch (error: unknown) {
            console.error('Error triggering Templater execution:', error);
        }
    }

    private toFrontmatterRecord(value: unknown): Record<string, FrontmatterValue> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        const record: Record<string, FrontmatterValue> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (this.isFrontmatterValue(entry)) {
                record[key] = entry;
            }
        }
        return record;
    }

    private isFrontmatterValue(value: unknown): value is FrontmatterValue {
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return true;
        }

        return Array.isArray(value) && value.every(item =>
            item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        );
    }

    private hasValue(value: FrontmatterValue | undefined): boolean {
        if (value === undefined || value === null) {
            return false;
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        return value !== '';
    }

    private normalizeTemplateValue(value: FrontmatterValue): FrontmatterValue {
        if (value === '' || value === '""' || value === "''") {
            return null;
        }

        if (!Array.isArray(value)) {
            return value;
        }

        return value.map(item => (item === '' || item === '""' || item === "''" ? null : item));
    }

    private formatFrontmatterValue(value: FrontmatterValue): string {
        if (value === null) {
            return '';
        }

        if (Array.isArray(value)) {
            return value.join(', ');
        }

        return String(value);
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
