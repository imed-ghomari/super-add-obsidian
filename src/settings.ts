export interface CustomField {
	name: string;
	type: 'string' | 'date' | 'datetime' | 'number' | 'boolean' | 'array';
	defaultValue?: any;
	isDefault?: boolean;
	useRegex?: boolean;
}

export interface Template {
	name: string;
	path: string;
	fields: Record<string, any>;
}

export interface TaskManagementProperties {
	enabled: boolean;
	duePropertyName: string;
	recurrencePropertyName: string;
}

export interface SuperAddSettings {
	defaultFolder: string;
	enableNLP: boolean;
	customFields: CustomField[];
	templates: Template[];
	taskManagementProperties: TaskManagementProperties;
}

export const DEFAULT_SETTINGS: SuperAddSettings = {
	defaultFolder: 'Tasks',
	enableNLP: true,
	customFields: [
		{ name: 'status', type: 'string', defaultValue: 'open', isDefault: true },
		{ name: 'priority', type: 'string', isDefault: true },
		{ name: 'due', type: 'date', isDefault: true },
		{ name: 'tags', type: 'array', isDefault: true },
		{ name: 'timeEstimate', type: 'number', isDefault: true }
	],
	templates: [],
	taskManagementProperties: {
		enabled: true,
		duePropertyName: 'due',
		recurrencePropertyName: 'recurrence'
	}
};