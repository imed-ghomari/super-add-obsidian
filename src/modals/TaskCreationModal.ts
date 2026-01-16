import { App, Modal, Setting, TextAreaComponent, ButtonComponent, TFile, MarkdownRenderer, Notice, parseYaml } from 'obsidian';
import { NaturalLanguageParser, ParsedTaskData } from '../services/NaturalLanguageParser';
import SuperAddPlugin from '../../main';
import { SuperAddSettings } from '../settings';
import { FolderSuggestModal } from './FolderSuggestModal';
import { LinkSuggestModal } from './LinkSuggestModal';


export interface TaskCreationOptions {
    initialValue?: string;
    folder?: string;
    placeholder?: string;
    enableNLP?: boolean;
    template?: string;
}

/**
 * Modal for creating tasks with natural language processing.
 */
export class TaskCreationModal extends Modal {
    private plugin: SuperAddPlugin;
    private nlpParser: NaturalLanguageParser;
    private previewEl: HTMLElement;
    private parsedData: ParsedTaskData;
    private options: TaskCreationOptions;

    private selectedTemplate: string | null = null;
     private templateData: Record<string, any> = {};
     private templateFields: string[] = [];
     private matchedTemplateFields: string[] = [];
     private inputEl: TextAreaComponent;
     private folderPath: string;

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

        // Set modal title
        contentEl.createEl('h2', { text: 'Create Task with Natural Language' });
        
        // Set initial folder path
        this.folderPath = this.options.folder || this.plugin.settings.defaultFolder;

        // Create natural language input
        this.createNaturalLanguageInput(contentEl);

        // Create preview section
        this.createPreviewSection(contentEl);

        // Create action buttons
        this.createActionButtons(contentEl);
        
        // Apply custom CSS for full-width layout
        contentEl.addClass('super-add-task-modal');
        
        // Add custom CSS to the document if not already added
        this.addCustomStyles();
    }
    
    /**
     * Adds custom CSS styles to the document for the modal layout
     */
    private addCustomStyles() {
        const styleId = 'super-add-task-modal-styles';
        
        // Check if styles are already added
        if (!document.getElementById(styleId)) {
            const styleEl = document.createElement('style');
            styleEl.id = styleId;
            styleEl.textContent = `
                .super-add-task-modal .super-add-input-container {
                    width: 100%;
                    margin-bottom: 20px;
                }
                
                .super-add-task-modal .setting-item {
                    display: block;
                    border: none;
                }
                
                .super-add-task-modal .setting-item-info {
                    width: 100%;
                    margin-bottom: 8px;
                }
                
                .super-add-task-modal .setting-item-control {
                    width: 100%;
                }
            `;
            document.head.appendChild(styleEl);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Creates the natural language input textarea with live parsing.
     */
    private createNaturalLanguageInput(container: HTMLElement) {
        const inputContainer = container.createDiv({ cls: 'super-add-input-container' });

        new Setting(inputContainer)
            .setName('Task Description')
            .then(setting => {
                this.inputEl = new TextAreaComponent(setting.controlEl);
                this.inputEl
                    .setPlaceholder('E.g., Call John about project tomorrow at 3pm -link to file property value...')
                    .setValue(this.options.initialValue || '')
                    .onChange(value => {
                        this.updatePreview(value);
                    });
                
                // Add keydown listener for link modal
                this.inputEl.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key === '-') {
                        // Check if this is the start of a new link (preceded by space or start of line)
                        const cursorPos = this.inputEl.inputEl.selectionStart;
                        const textBefore = this.inputEl.getValue().substring(0, cursorPos);
                        const lastChar = textBefore.charAt(textBefore.length - 1);
                        
                        if (lastChar === ' ' || lastChar === '' || lastChar === '\n') {
                            // Open link modal after a short delay to allow the "-" to be inserted
                            setTimeout(() => {
                                this.openLinkModal();
                            }, 10);
                        }
                    }
                });

                // Set initial height and make it auto-expandable
                this.inputEl.inputEl.style.width = '100%';
                this.inputEl.inputEl.style.height = '100px';
                this.inputEl.inputEl.style.minHeight = '100px';
                
                // Add command+enter shortcut
                this.inputEl.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        this.createTask();
                    }
                });

                // Set initial focus
                setTimeout(() => {
                    this.inputEl.inputEl.focus();
                    this.updatePreview(this.inputEl.getValue());
                }, 10);
            });
    }

    /**
     * Creates the preview section that shows parsed task data.
     */
    private createPreviewSection(container: HTMLElement) {
        const previewContainer = container.createDiv({ cls: 'super-add-preview-container' });
        
        previewContainer.createEl('h3', { text: 'Preview' });
        
        this.previewEl = previewContainer.createDiv({ cls: 'super-add-preview' });
        this.previewEl.createEl('div', { text: 'Enter task description to see preview', cls: 'super-add-preview-placeholder' });
    }

    /**
     * Creates action buttons for the modal.
     */
    private createActionButtons(container: HTMLElement) {
        const buttonContainer = container.createDiv({ cls: 'super-add-button-container' });



        // Cancel button
        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => {
                this.close();
            });

        // Create button
        new ButtonComponent(buttonContainer)
            .setButtonText('Create Task')
            .setCta()
            .onClick(() => {
                this.createTask();
            });
    }
    

    


    /**
     * Updates the preview based on the current input.
     */
    /**
     * Loads template data from a template file.
     */
    private async loadTemplateData(templateName: string) {
        // Find the template in settings
        const template = this.plugin.settings.templates.find((t: any) => t.name === templateName);
        if (!template) {
            this.templateData = {};
            this.templateFields = [];
            return;
        }
        
        try {
            // Get the template file
            const file = this.app.vault.getAbstractFileByPath(template.path);
            if (!(file instanceof TFile)) {
                console.error('Template file not found:', template.path);
                return;
            }
            
            // Read the file content
            const content = await this.app.vault.read(file);
            
            // Extract frontmatter using Obsidian's YAML parser for correctness
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch && frontmatterMatch[1]) {
                const frontmatterContent = frontmatterMatch[1];
                const parsed = parseYaml(frontmatterContent) || {};
                // Ensure we have a plain object
                const parsedFrontmatter: Record<string, any> = { ...parsed };
                this.templateData = parsedFrontmatter;
                this.templateFields = Object.keys(this.templateData);

                // Keep track of which fields can be processed by NLP (matched with settings)
                this.matchedTemplateFields = [];
                if (this.plugin.settings.customFields) {
                    this.matchedTemplateFields = this.templateFields.filter(field => {
                        // Include if it's a custom field
                        const isCustomField = this.plugin.settings.customFields.some((customField: any) => 
                            customField.name === field
                        );
                        
                        // Include if it's a task management property
                        const isTaskManagementProperty = this.plugin.settings.taskManagementProperties.enabled && 
                            (field === this.plugin.settings.taskManagementProperties.duePropertyName ||
                             field === this.plugin.settings.taskManagementProperties.recurrencePropertyName);
                        
                        return isCustomField || isTaskManagementProperty;
                    });
                }
            } else {
                this.templateData = {};
                this.templateFields = [];
            }
        } catch (error) {
            console.error('Error loading template data:', error);
        }
    }

    /**
     * Updates the preview based on the current input.
     */
    private async updatePreview(input: string) {
        if (!input) {
            this.previewEl.empty();
            this.previewEl.createEl('div', { text: 'Enter task description to see preview', cls: 'super-add-preview-placeholder' });
            return;
        }

        // Parse the input
        this.parsedData = this.nlpParser.parseInput(input);

        // Update preview
        this.previewEl.empty();

        // Title
        const titleEl = this.previewEl.createEl('div', { cls: 'super-add-preview-title' });
        titleEl.createEl('strong', { text: 'Title: ' });
        titleEl.createSpan({ text: this.parsedData.title || '(No title)' });

        // Details (if any)
        if (this.parsedData.details) {
            const detailsEl = this.previewEl.createEl('div', { cls: 'super-add-preview-details' });
            detailsEl.createEl('strong', { text: 'Details: ' });
            const detailsContent = detailsEl.createDiv({ cls: 'super-add-preview-details-content' });
            MarkdownRenderer.renderMarkdown(this.parsedData.details, detailsContent, '', this.plugin);
        }
        


        // Load template data if a template is recognized
        if (this.parsedData.template && this.parsedData.template !== this.selectedTemplate) {
            this.selectedTemplate = this.parsedData.template;
            await this.loadTemplateData(this.selectedTemplate);
        } else if (!this.parsedData.template) {
            this.selectedTemplate = null;
            this.templateData = {};
            this.templateFields = [];
        }

        // Create unified preview with pill formatting
        this.createUnifiedPreview();
    }

    /**
     * Creates a unified preview with pill formatting for all properties.
     */
    private createUnifiedPreview() {
        // Clear any existing preview items
        const existingItems = this.previewEl.querySelectorAll('.super-add-preview-item, .super-add-preview-template-field');
        existingItems.forEach(item => item.remove());

        // Collect all properties to display
        const allProperties: Array<{key: string, value: any, isTemplate: boolean}> = [];

        // Add template properties if template is selected
        if (this.selectedTemplate && this.templateFields.length > 0) {
            // Filter template fields to only show those that match settings
            const filteredTemplateFields = this.templateFields.filter(field => {
                if (field === 'title') return false; // Skip title
                
                // Check if it's a custom field
                const isCustomField = this.plugin.settings.customFields.some((customField: any) => 
                    customField.name === field
                );
                
                // Check if it's a task management property
                const isTaskManagementProperty = this.plugin.settings.taskManagementProperties.enabled && 
                    (field === this.plugin.settings.taskManagementProperties.duePropertyName ||
                     field === this.plugin.settings.taskManagementProperties.recurrencePropertyName);
                
                // Check if it's a standard property that should be shown (tags, etc.)
                const isStandardProperty = field === 'tags';
                
                return isCustomField || isTaskManagementProperty || isStandardProperty;
            });
            
            // Only show template header if there are filtered fields to display
            if (filteredTemplateFields.length > 0) {
                const templateHeader = this.previewEl.createDiv('super-add-template-header');
                templateHeader.setText(`📋 ${this.selectedTemplate} Properties`);
            }
            
            for (const field of filteredTemplateFields) {
                // Check if this field has a value from parsing first
                let fieldValue = this.parsedData.customFields && this.parsedData.customFields[field] 
                    ? this.parsedData.customFields[field] 
                    : this.templateData[field] || null;
                
                // Handle array values properly
                let displayValue = fieldValue;
                if (Array.isArray(fieldValue)) {
                    displayValue = fieldValue.length > 0 ? fieldValue.join(', ') : '';
                }
                
                // Show filtered template properties
                allProperties.push({
                    key: field,
                    value: displayValue || '',
                    isTemplate: true
                });
            }
        }

        // Add parsed properties that are not already in template
        if (this.parsedData.customFields && Object.keys(this.parsedData.customFields).length > 0) {
            for (const [fieldName, fieldValue] of Object.entries(this.parsedData.customFields)) {
                // Check if this property is already in template properties
                const isInTemplate = allProperties.some(p => p.key === fieldName && p.isTemplate);
                if (!isInTemplate && fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                    allProperties.push({
                        key: fieldName,
                        value: fieldValue,
                        isTemplate: false
                    });
                }
            }
        }

        // Add task management properties if enabled
        if (this.plugin.settings.taskManagementProperties.enabled) {
            const duePropertyName = this.plugin.settings.taskManagementProperties.duePropertyName;
            const recurrencePropertyName = this.plugin.settings.taskManagementProperties.recurrencePropertyName;
            
            // Add due date if available
            if (this.parsedData.dueDate) {
                // Check if due property is already in template properties
                const existingDueIndex = allProperties.findIndex(p => p.key === duePropertyName);
                if (existingDueIndex !== -1) {
                    // Update existing due property with the parsed date
                    allProperties[existingDueIndex].value = this.parsedData.dueDate;
                } else {
                    // Add new due property
                    allProperties.push({
                        key: duePropertyName,
                        value: this.parsedData.dueDate,
                        isTemplate: false
                    });
                }
            }
            
            // Add recurrence if available - check for duplication with template
            if (this.parsedData.recurrence) {
                const existingRecurrenceIndex = allProperties.findIndex(p => p.key === recurrencePropertyName);
                if (existingRecurrenceIndex !== -1) {
                    // Update existing recurrence property with the parsed value
                    allProperties[existingRecurrenceIndex].value = this.parsedData.recurrence;
                } else {
                    // Add new recurrence property
                    allProperties.push({
                        key: recurrencePropertyName,
                        value: this.parsedData.recurrence,
                        isTemplate: false
                    });
                }
            }
        }

        if (this.parsedData.tags && this.parsedData.tags.length > 0) {
            allProperties.push({
                key: 'tags',
                value: this.parsedData.tags.join(', '),
                isTemplate: false
            });
        }

        // Create pill container
        const pillContainer = this.previewEl.createDiv('super-add-pill-container');
        
        // Display each property as a pill
        for (const prop of allProperties) {
            const pill = pillContainer.createDiv('super-add-pill');
            const propertyName = pill.createSpan('property-name');
            propertyName.setText(`${prop.key}:`);
            const propertyValue = pill.createSpan('property-value');
            propertyValue.setText(` ${prop.value}`);
        }
    }

    /**
     * Opens the link suggest modal
     */
    private openLinkModal() {
        const linkModal = new LinkSuggestModal(this.app, (file: TFile) => {
            const cursorPos = this.inputEl.inputEl.selectionStart;
            const currentValue = this.inputEl.getValue();
            const beforeCursor = currentValue.substring(0, cursorPos);
            const afterCursor = currentValue.substring(cursorPos);
            
            // Find and remove the "-" that triggered this modal
            let adjustedBeforeCursor = beforeCursor;
            if (adjustedBeforeCursor.endsWith('-')) {
                adjustedBeforeCursor = adjustedBeforeCursor.slice(0, -1);
            }
            
            // Replace the "-" with a link
            const linkText = `[[${file.basename}]]`;
            const newValue = adjustedBeforeCursor + linkText + afterCursor;
            
            this.inputEl.setValue(newValue);
            
            // Set cursor position after the link
            const newCursorPos = adjustedBeforeCursor.length + linkText.length;
            setTimeout(() => {
                this.inputEl.inputEl.setSelectionRange(newCursorPos, newCursorPos);
                this.inputEl.inputEl.focus();
            }, 10);
            
            this.updatePreview(newValue);
        });
        
        linkModal.open();
    }

    /**
     * Creates a task based on the parsed data.
     */
    private async createTask() {
        try {
            // Close the modal first
            this.close();

            // Open folder selection modal first
            new FolderSuggestModal(this.app, this.plugin, {
                callback: async (folderPath: string) => {
                    await this.createFileInFolder(folderPath);
                },
                initialFolder: this.options.folder || this.plugin.settings.defaultFolder
            }).open();
        } catch (error) {
            console.error('Error creating task:', error);
            this.plugin.showNotice('Error creating task: ' + error.message, true);
        }
    }

    /**
     * Creates the file in the specified folder with template and properties applied.
     */
    private async createFileInFolder(targetFolder: string) {
        try {
            // Create frontmatter object
            const frontmatter: Record<string, any> = {};
            
            // Add custom fields from parsed data
            if (this.parsedData.customFields && Object.keys(this.parsedData.customFields).length > 0) {
                for (const [fieldName, fieldValue] of Object.entries(this.parsedData.customFields)) {
                    // Only add if value is not null/undefined/empty
                    if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                        frontmatter[fieldName] = fieldValue;
                    }
                }
            }
            
            // Add task management properties if enabled
            if (this.plugin.settings.taskManagementProperties.enabled) {
                const duePropertyName = this.plugin.settings.taskManagementProperties.duePropertyName;
                const recurrencePropertyName = this.plugin.settings.taskManagementProperties.recurrencePropertyName;
                
                // Add due date if available and not already set by custom fields
                if (this.parsedData.dueDate && !frontmatter[duePropertyName]) {
                    frontmatter[duePropertyName] = this.parsedData.dueDate;
                }
                
                if (this.parsedData.dueTime) {
                    frontmatter['time'] = this.parsedData.dueTime;
                }
                
                // Add recurrence if available
                if (this.parsedData.recurrence) {
                    frontmatter[recurrencePropertyName] = this.parsedData.recurrence;
                }
            }
            
            if (this.parsedData.scheduledDate) {
                frontmatter['scheduled'] = this.parsedData.scheduledDate;
            }
            
            if (this.parsedData.scheduledTime) {
                frontmatter['scheduledTime'] = this.parsedData.scheduledTime;
            }
            
            
            if (this.parsedData.tags && this.parsedData.tags.length > 0) {
                frontmatter['tags'] = this.parsedData.tags;
            }
            
            if (this.parsedData.estimate) {
                frontmatter['timeEstimate'] = this.parsedData.estimate;
            }
            
            // Add template fields if a template is selected
            if (this.selectedTemplate && Object.keys(this.templateData).length > 0) {
                for (const field in this.templateData) {
                    // Only add if not already set by NLP or other means
                    if (frontmatter[field] === undefined) {
                        const value = this.templateData[field];
                        // Add ALL template properties, set empty ones to null
                        if (value === '' || value === '""' || value === "''") {
                            frontmatter[field] = null;
                        } else if (Array.isArray(value)) {
                            // For arrays, convert empty items to null but keep the array
                            frontmatter[field] = value.map(item => {
                                if (item === '' || item === '""' || item === "''") {
                                    return null;
                                }
                                return item;
                            });
                        } else {
                            frontmatter[field] = value;
                        }
                    }
                }
            }
            
            // Create a sanitized filename from the title
            const sanitizedTitle = this.sanitizeFilename(this.parsedData.title);
            const filename = `${sanitizedTitle}.md`;
            
            // Create the folder if it doesn't exist
            try {
                await this.app.vault.createFolder(targetFolder);
            } catch (e) {
                // Folder might already exist, ignore error
            }
            
            // Reorder frontmatter keys to follow template order first, then others
            let orderedFrontmatter: Record<string, any> = {};
            if (this.selectedTemplate && this.templateFields && this.templateFields.length > 0) {
                // Add all template fields in the original order
                for (const key of this.templateFields) {
                    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
                        orderedFrontmatter[key] = frontmatter[key];
                    } else if (Object.prototype.hasOwnProperty.call(this.templateData, key)) {
                        // Ensure template fields exist even if null
                        orderedFrontmatter[key] = this.templateData[key] === '' ? null : this.templateData[key];
                    } else {
                        orderedFrontmatter[key] = null;
                    }
                }
                // Append any other keys not present in the template (e.g., tags, scheduled)
                for (const [key, value] of Object.entries(frontmatter)) {
                    if (!this.templateFields.includes(key)) {
                        orderedFrontmatter[key] = value;
                    }
                }
            } else {
                orderedFrontmatter = frontmatter;
            }

            // Generate YAML frontmatter
            const yamlFrontmatter = this.generateYamlFrontmatter(orderedFrontmatter);
            
            // Create file content with frontmatter and details (no title duplication)
            const fileContent = `---
${yamlFrontmatter}---

${this.parsedData.details || ''}`;
            
            // Create the file in the folder
            const filePath = `${targetFolder}/${filename}`;
            const file = await this.app.vault.create(filePath, fileContent);
            
            // Trigger Templater plugin if available and template was used
            if (this.selectedTemplate) {
                await this.triggerTemplaterExecution(file);
            }
            
            // Open the file in a new tab
            await this.app.workspace.getLeaf(true).openFile(file);
        } catch (error) {
            console.error('Error creating file:', error);
            this.plugin.showNotice('Error creating file: ' + error.message, true);
        }
    }
    

    
    /**
     * Sanitizes a string for use as a filename.
     */
    private sanitizeFilename(input: string): string {
         // Remove invalid filename characters
         return input.replace(/[\\/:*?"<>|]/g, '');
     }
    
    /**
     * Generates YAML frontmatter from an object.
     */
    private generateYamlFrontmatter(data: Record<string, any>): string {
        const lines: string[] = [];
        
        for (const [key, value] of Object.entries(data)) {
            // Skip undefined, but include null as an explicit empty YAML entry
            if (value === undefined) continue;
            if (value === null) {
                lines.push(`${key}: `);
                continue;
            }
            
            if (Array.isArray(value)) {
                if (value.length === 0) continue;
                
                lines.push(`${key}:`);
                for (const item of value) {
                    lines.push(`  - ${this.escapeYamlValue(item)}`);
                }
            } else if (typeof value === 'string') {
                if (value.includes('\n') || value.includes(':') || value.includes('#')) {
                    // Multi-line or special characters
                    lines.push(`${key}: |
  ${value.replace(/\n/g, '\n  ')}`);
                } else {
                    lines.push(`${key}: ${this.escapeYamlValue(value)}`);
                }
            } else {
                // Numbers, booleans, etc.
                lines.push(`${key}: ${value}`);
            }
        }
        
        // Add a line break at the end to ensure proper frontmatter formatting
        return lines.join('\n') + '\n';
    }
    
    /**
     * Escapes a string value for YAML.
     */
    private escapeYamlValue(value: string): string {
        if (typeof value !== 'string') return value;
        
        // If the string contains special characters, wrap it in quotes
        if (/[:\[\]{}\-#,]/g.test(value) || /^['"]/.test(value)) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        
        return value;
    }
    
    /**
     * Triggers Templater plugin execution on the created file if available.
     */
    private async triggerTemplaterExecution(file: TFile): Promise<void> {
        try {
            // Check if Templater plugin is available
            const templaterPlugin = (this.app as any).plugins?.plugins?.['templater-obsidian'];
            
            if (templaterPlugin && templaterPlugin.templater) {
                // Give the file a moment to be fully created and indexed
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Trigger Templater processing on the file
                await templaterPlugin.templater.overwrite_file_commands(file);
                
                console.log('Templater execution triggered for file:', file.path);
            } else {
                console.log('Templater plugin not found or not enabled');
            }
        } catch (error) {
            console.error('Error triggering Templater execution:', error);
            // Don't throw error to avoid breaking file creation flow
        }
    }
    
    /**
     * Gets the priority symbol based on the priority value.
     */
    private getPrioritySymbol(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'urgent':
            case 'critical':
            case 'highest':
                return '🔴';
            case 'high':
                return '🟠';
            case 'normal':
            case 'medium':
                return '🟡';
            case 'low':
                return '🟢';
            default:
                return '⚪';
        }
    }
}