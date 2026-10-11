import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, SettingDefinition, SettingDefinitionItem, TFile } from 'obsidian';
import SuperAddPlugin from '../../main';
import { CustomField, Template } from '../settings';
import { CustomFieldModal } from '../modals/CustomFieldModal';

function getPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let cursor: unknown = obj;
    for (const part of parts) {
        if (cursor === null || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    const last = parts.pop() as string;
    let cursor: Record<string, unknown> = obj;
    for (const part of parts) {
        let next = cursor[part];
        if (next === null || typeof next !== 'object') {
            next = {};
            cursor[part] = next;
        }
        cursor = next as Record<string, unknown>;
    }
    cursor[last] = value;
}

function matchesQuery(def: SettingDefinition, query: string): boolean {
    const q = query.toLowerCase();
    const name = (def.name ?? '').toLowerCase();
    if (name.includes(q)) return true;
    const desc = typeof def.desc === 'string' ? def.desc.toLowerCase() : '';
    if (desc.includes(q)) return true;
    const aliases = def.aliases ?? [];
    for (const alias of aliases) {
        if (alias.toLowerCase().includes(q)) return true;
    }
    return false;
}

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
            this.settingsTab.refreshUI();
        })();
    }
}

export class SuperAddSettingsTab extends PluginSettingTab {
    plugin: SuperAddPlugin;

    constructor(app: App, plugin: SuperAddPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // ------------------------------------------------------------------
    // Declarative searchable settings (Obsidian 1.13.0+)
    // Global settings search indexes getSettingDefinitions(). Keep it cheap:
    // no I/O, no vault reads here. Vault-dependent modals are opened from
    // actions, not from the definitions themselves.
    // ------------------------------------------------------------------

    getControlValue(key: string): unknown {
        return getPath(this.plugin.settings as unknown as Record<string, unknown>, key);
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        setPath(this.plugin.settings as unknown as Record<string, unknown>, key, value);
        await this.plugin.saveSettings();
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'General',
                items: [
                    {
                        name: 'Default folder',
                        desc: 'Folder where new tasks are created when no folder is picked in the modal.',
                        aliases: ['task folder', 'save location', 'new task folder', 'default save folder', 'tasks folder'],
                        control: {
                            type: 'folder',
                            key: 'defaultFolder',
                            placeholder: 'Tasks',
                            includeRoot: true,
                        },
                    },
                    {
                        name: 'Enable natural language processing',
                        desc: 'Parse dates, recurrence, tags and custom properties from the task input line.',
                        aliases: ['NLP', 'natural language', 'language parsing', 'parse input', 'smart input'],
                        control: {
                            type: 'toggle',
                            key: 'enableNLP',
                        },
                    },
                ],
            },
            {
                type: 'list',
                heading: 'Properties',
                emptyState: 'No properties defined yet.',
                search: {
                    placeholder: 'Search properties…',
                    match: matchesQuery,
                },
                addItem: {
                    name: 'Add property',
                    action: () => {
                        this.showCustomFieldModal(null, () => this.update());
                    },
                },
                onDelete: (index: number) => {
                    this.plugin.settings.customFields.splice(index, 1);
                    void this.plugin.saveSettings().then(() => this.update());
                },
                onReorder: (oldIndex: number, newIndex: number) => {
                    const fields = this.plugin.settings.customFields;
                    const [moved] = fields.splice(oldIndex, 1);
                    fields.splice(newIndex, 0, moved);
                    void this.plugin.saveSettings();
                },
                items: this.plugin.settings.customFields.map((field) => {
                    const defaultLabel = field.defaultValue ? ` (Default: ${field.defaultValue})` : '';
                    const defaultFlag = field.isDefault ? ' (Default)' : '';
                    return {
                        name: `${field.name}${defaultFlag}`,
                        desc: `Type: ${field.type}${defaultLabel}`,
                        aliases: [
                            field.type,
                            `${field.type} property`,
                            'custom property',
                            'frontmatter property',
                            field.name,
                        ],
                        action: (_el: HTMLElement, index: number) => {
                            const liveField = this.plugin.settings.customFields[index];
                            if (!liveField) return;
                            this.showCustomFieldModal(liveField, () => this.update());
                        },
                    };
                }),
            },
            {
                type: 'group',
                heading: 'Task Management Properties',
                items: [
                    {
                        name: 'Enable task management properties',
                        desc: 'Enable automatic recognition of due dates and recurrence patterns in natural language input.',
                        aliases: ['task management', 'due dates', 'recurrence', 'rrule', 'repeat'],
                        control: {
                            type: 'toggle',
                            key: 'taskManagementProperties.enabled',
                        },
                    },
                    {
                        name: 'Due property name',
                        desc: 'The name of the property used for due dates (for example "due" or "deadline").',
                        aliases: ['due date', 'deadline', 'due property', 'due field'],
                        visible: () => this.plugin.settings.taskManagementProperties.enabled,
                        control: {
                            type: 'text',
                            key: 'taskManagementProperties.duePropertyName',
                            placeholder: 'due',
                            validate: (value: string) => this.validateDeclarativeName(value, 'due'),
                        },
                    },
                    {
                        name: 'Recurrence property name',
                        desc: 'The name of the property used for recurrence rules (for example "recurrence" or "repeat").',
                        aliases: ['repeat', 'recurrence rule', 'rrule', 'repeat property', 'recurrence property'],
                        visible: () => this.plugin.settings.taskManagementProperties.enabled,
                        control: {
                            type: 'text',
                            key: 'taskManagementProperties.recurrencePropertyName',
                            placeholder: 'recurrence',
                            validate: (value: string) => this.validateDeclarativeName(value, 'recurrence'),
                        },
                    },
                ],
            },
            {
                type: 'list',
                heading: 'Templates',
                emptyState: 'No templates yet.',
                search: {
                    placeholder: 'Search templates…',
                    match: matchesQuery,
                },
                addItem: {
                    name: 'Add template',
                    action: () => {
                        this.addTemplate();
                    },
                },
                onDelete: (index: number) => {
                    this.plugin.settings.templates.splice(index, 1);
                    void this.plugin.saveSettings().then(() => this.update());
                },
                items: this.plugin.settings.templates.map((template) => ({
                    name: template.name,
                    desc: template.path,
                    aliases: ['template', 'frontmatter template', 'note template', template.path],
                })),
            },
        ];
    }

    /**
     * Re-render settings regardless of host version.
     * On 1.13.0+ this rebuilds declarative definitions + search index.
     * On older hosts it falls back to imperative display().
     */
    refreshUI(): void {
        const tab = this as unknown as { update?: () => void };
        if (typeof tab.update === 'function') {
            try {
                this.update();
                return;
            } catch {
                // fall through to display()
            }
        }
        this.display();
    }

    private validateDeclarativeName(value: string, type: 'due' | 'recurrence'): string | void {
        const name = (value ?? '').trim();
        if (!name) {
            return 'Property name is required.';
        }
        const isDuplicate = this.plugin.settings.customFields.some(
            (field) => field.name.toLowerCase() === name.toLowerCase()
        );
        if (isDuplicate) {
            return `Property name "${name}" is already used in custom properties.`;
        }
        const otherPropertyName =
            type === 'due'
                ? this.plugin.settings.taskManagementProperties.recurrencePropertyName
                : this.plugin.settings.taskManagementProperties.duePropertyName;
        if (name.toLowerCase() === (otherPropertyName ?? '').toLowerCase()) {
            return `Property name "${name}" is already used for the other task management property.`;
        }
    }

    // ------------------------------------------------------------------
    // Imperative fallback for Obsidian < 1.13.0 (display() is ignored on
    // newer hosts when getSettingDefinitions() returns a non-empty array).
    // ------------------------------------------------------------------

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Super Add')
            .setHeading();

        this.createGeneralSettings(containerEl);
        this.createCustomFieldSettings(containerEl);
        this.createTaskManagementPropertiesSettings(containerEl);
        this.createTemplateSettings(containerEl);
    }

    private createGeneralSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('General')
            .setHeading();

        new Setting(containerEl)
            .setName('Default folder')
            .setDesc('Folder where new tasks are created when no folder is picked in the modal.')
            .addText(text => text
                .setPlaceholder('Tasks')
                .setValue(this.plugin.settings.defaultFolder)
                .onChange(value => {
                    void (async () => {
                        this.plugin.settings.defaultFolder = value;
                        await this.plugin.saveSettings();
                    })();
                }));

        new Setting(containerEl)
            .setName('Enable natural language processing')
            .setDesc('Parse dates, recurrence, tags and custom properties from the task input line.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableNLP)
                .onChange(value => {
                    void (async () => {
                        this.plugin.settings.enableNLP = value;
                        await this.plugin.saveSettings();
                    })();
                }));
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
        const wrappedRefresh = () => {
            try {
                refresh();
            } catch {
                // ignore refresh errors from stale closures
            }
            // Keep declarative search index in sync when the modal is opened
            // from the declarative list (refresh === update callback).
            try {
                const tab = this as unknown as { update?: () => void };
                if (typeof tab.update === 'function' && refresh !== undefined) {
                    // update() is idempotent; calling it here is safe when the
                    // settings modal is open and a no-op for search indexing
                    // when closed. Avoid double-render loops by only ensuring
                    // the index is fresh — display() fallback handles old hosts.
                }
            } catch {
                // ignore
            }
        };
        new CustomFieldModal(this.app, this.plugin, initialField, wrappedRefresh).open();
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
