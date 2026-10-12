import { App, FuzzySuggestModal, PluginSettingTab, SettingDefinition, SettingDefinitionItem, TFile } from 'obsidian';
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
            this.settingsTab.update();
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
    // Declarative searchable settings.
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
                heading: 'Task defaults',
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

    private showCustomFieldModal(initialField: CustomField | null, refresh: () => void): void {
        new CustomFieldModal(this.app, this.plugin, initialField, refresh).open();
    }

    private addTemplate(): void {
        new TemplateSelectionModal(this.app, this.plugin, this).open();
    }
}
