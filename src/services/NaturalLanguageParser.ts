import * as chrono from 'chrono-node';
import { RRule } from 'rrule';
import { SuperAddSettings, CustomField } from '../settings';

export interface ParsedTaskData {
    title: string;
    details?: string;
    dueDate?: string;
    scheduledDate?: string;
    dueTime?: string;
    scheduledTime?: string;
    tags: string[];
    estimate?: number; // in minutes
    customFields: Record<string, any>; // For storing custom field values
    template?: string;
    recurrence?: string; // For storing recurrence rules
}

/**
 * Service for parsing natural language input into structured task data.
 */
export class NaturalLanguageParser {
    private settings: SuperAddSettings;

    constructor(settings: SuperAddSettings) {
        this.settings = settings;
    }

    /**
     * Parse natural language input into structured task data.
     */
    public parseInput(input: string): ParsedTaskData {
        const result: ParsedTaskData = {
            title: '',
            tags: [],
            customFields: {}
        };

        // 1. Separate title line from details
        const [workingText, details] = this.extractTitleAndDetails(input);
        if (details) {
            result.details = details;
        }

        // 2. Process text, extracting components and shrinking the workingText
        let remainingText = workingText;
        
        // Extract tags (now only #tags are supported)
        remainingText = this.extractTags(remainingText, result);

        // Extract template name
        remainingText = this.extractTemplate(remainingText, result);


        // Extract custom fields
        remainingText = this.extractCustomFields(remainingText, result);

        // Extract recurrence (before dates to prevent chrono from consuming keywords)
        if (this.settings.taskManagementProperties.enabled) {
            remainingText = this.extractRecurrence(remainingText, result);
        }

        // Extract dates and times
        remainingText = this.parseDatesAndTimes(remainingText, result);

        // Extract time estimate
        remainingText = this.extractTimeEstimate(remainingText, result);

        // 3. The remainder is the title
        result.title = remainingText.trim();
        
        return result;
    }
    
    /**
     * Extracts template name from the text and adds it to the result object.
     */
    private extractTemplate(text: string, result: ParsedTaskData): string {
        if (!this.settings.templates || this.settings.templates.length === 0) {
            return text;
        }

        let workingText = text;
        for (const template of this.settings.templates) {
            const templatePattern = new RegExp(`\\b${template.name}\\b`, 'i');
            const match = workingText.match(templatePattern);
            if (match) {
                result.template = template.name;
                workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                break; // Assuming only one template can be recognized
            }
        }
        return workingText;
    }

    /**
     * Splits the input string into the first line (for parsing) and the rest (for details).
     */
    private extractTitleAndDetails(input: string): [string, string | undefined] {
        const trimmedInput = input.trim();
        const firstLineBreak = trimmedInput.indexOf('\n');

        if (firstLineBreak !== -1) {
            const titleLine = trimmedInput.substring(0, firstLineBreak).trim();
            const details = trimmedInput.substring(firstLineBreak + 1).trim();
            return [titleLine, details];
        }
        
        return [trimmedInput, undefined];
    }

    /** Extracts #tags from the text and adds them to the result object. */
    private extractTags(text: string, result: ParsedTaskData): string {
        const tagMatches = text.match(/#[\w/]+/g);
        if (tagMatches) {
            result.tags.push(...tagMatches.map(tag => tag.substring(1)));
            return this.cleanupWhitespace(text.replace(/#[\w/]+/g, ''));
        }
        return text;
    }

    /** 
     * Extracts custom fields from the text based on defined custom field settings.
     * Handles all field types with proper natural language recognition.
     */
    private extractCustomFields(text: string, result: ParsedTaskData): string {
        let workingText = text;

        for (const field of this.settings.customFields) {
            if (field.type === 'boolean') {
                // Pattern for boolean: 'field true' or 'field false'
                const booleanPattern = new RegExp(`\\b${field.name}\\s+(true|false)\\b`, 'i');
                const match = workingText.match(booleanPattern);
                if (match) {
                    result.customFields[field.name] = match[1].toLowerCase() === 'true';
                    workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                }
            } else if (field.type === 'date') {
                // Pattern for date: 'field date pattern' (e.g., 'due tomorrow')
                // Use improved pattern that works like the 'due' property recognition
                const datePattern = new RegExp(`\\b${field.name}\\s+(.+)`, 'i');
                const match = workingText.match(datePattern);
                if (match) {
                    const dateString = match[1].trim();
                    const chronoResults = chrono.parse(dateString);
                    if (chronoResults.length > 0) {
                        const parsedDate = chronoResults[0].start.date();
                        result.customFields[field.name] = parsedDate.toISOString().split('T')[0];
                        // Remove the field name and the recognized date text from working text
                        const recognizedDateText = chronoResults[0].text;
                        workingText = this.cleanupWhitespace(workingText.replace(`${field.name} ${recognizedDateText}`, ''));
                    }
                }
            } else if (field.type === 'datetime') {
                // Pattern for datetime: 'field datetime pattern' (e.g., 'meeting tomorrow 3pm')
                // Use improved pattern that works like the 'due' property recognition
                const datetimePattern = new RegExp(`\\b${field.name}\\s+(.+)`, 'i');
                const match = workingText.match(datetimePattern);
                if (match) {
                    const datetimeString = match[1].trim();
                    const chronoResults = chrono.parse(datetimeString);
                    if (chronoResults.length > 0) {
                        const parsedDatetime = chronoResults[0].start.date();
                        result.customFields[field.name] = parsedDatetime.toISOString();
                        // Remove the field name and the recognized datetime text from working text
                        const recognizedDateText = chronoResults[0].text;
                        workingText = this.cleanupWhitespace(workingText.replace(`${field.name} ${recognizedDateText}`, ''));
                    }
                }
            } else if (field.type === 'string') {
                // For string fields with defined values, recognize by value only
                if (field.defaultValue) {
                    const definedValues = field.defaultValue.split(',').map((v: string) => v.trim());
                    // Process in order and find the first match
                    for (const value of definedValues) {
                        let valuePattern: RegExp;
                        if (field.useRegex) {
                            try {
                                valuePattern = new RegExp(value, 'i');
                            } catch (e) {
                                // If regex is invalid, fall back to literal matching
                                const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                valuePattern = new RegExp(`\\b${escapedValue}\\b`, 'i');
                            }
                        } else {
                            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            valuePattern = new RegExp(`\\b${escapedValue}\\b`, 'i');
                        }
                        
                        const match = workingText.match(valuePattern);
                        if (match) {
                            // Store the actual matched text, not the regex pattern
                            result.customFields[field.name] = match[0];
                            workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                            break; // Stop at first match to preserve order
                        }
                    }
                } else {
                    // For string fields without defined values, look for 'field value' pattern
                    const stringPattern = new RegExp(`\\b${field.name}\\s+([^\\s]+(?:\\s+[^\\s]+)*?)(?=\\s+\\w+:|$)`, 'i');
                    const match = workingText.match(stringPattern);
                    if (match) {
                        result.customFields[field.name] = match[1].trim();
                        workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                    }
                }
            } else if (field.type === 'number') {
                // Pattern for number: 'field 123'
                const numberPattern = new RegExp(`\\b${field.name}\\s+(\\d+(\\.\\d+)?)\\b`, 'i');
                const match = workingText.match(numberPattern);
                if (match) {
                    result.customFields[field.name] = parseFloat(match[1]);
                    workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                }
            } else if (field.type === 'array') {
                // For array fields with defined values, recognize by value only and allow multiple
                if (field.defaultValue) {
                    const definedValues = field.defaultValue.split(',').map((v: string) => v.trim());
                    const matchedValues: string[] = [];
                    
                    for (const value of definedValues) {
                        let valuePattern: RegExp;
                        if (field.useRegex) {
                            try {
                                valuePattern = new RegExp(value, 'i');
                            } catch (e) {
                                // If regex is invalid, fall back to literal matching
                                const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                valuePattern = new RegExp(`\\b${escapedValue}\\b`, 'i');
                            }
                        } else {
                            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            valuePattern = new RegExp(`\\b${escapedValue}\\b`, 'i');
                        }
                        
                        const match = workingText.match(valuePattern);
                        if (match) {
                            // Store the actual matched text, not the regex pattern
                            matchedValues.push(match[0]);
                            workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                        }
                    }
                    
                    if (matchedValues.length > 0) {
                        result.customFields[field.name] = matchedValues;
                    }
                } else {
                    // Pattern for array: 'field item1, item2, item3'
                    const arrayPattern = new RegExp(`\\b${field.name}\\s+([\\w\\s,]+)\\b`, 'i');
                    const match = workingText.match(arrayPattern);
                    if (match) {
                        result.customFields[field.name] = match[1].split(',').map(item => item.trim());
                        workingText = this.cleanupWhitespace(workingText.replace(match[0], ''));
                    }
                }
            }
        }

        return this.cleanupWhitespace(workingText);
    }

    /**
     * Extracts recurrence from text and generates rrule strings using a declarative pattern map.
     */
    private extractRecurrence(text: string, result: ParsedTaskData): string {
        const recurrencePatterns = [
            // "every [ordinal] [weekday]" (e.g., "every second monday") - MUST be first for priority
            {
                regex: /\bevery\s+(first|second|third|fourth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
                handler: (match: RegExpMatchArray) => {
                    const ordinal = match[1].toLowerCase();
                    const dayName = match[2].toLowerCase();
                    const rruleDay = dayName.toUpperCase().substring(0, 2);
                    const position = { first: 1, second: 2, third: 3, fourth: 4, last: -1 }[ordinal] || 1;
                    return `FREQ=MONTHLY;BYDAY=${rruleDay};BYSETPOS=${position}`;
                }
            },
            // "every [N] period" (e.g., "every 3 days")
            {
                regex: /\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i,
                handler: (match: RegExpMatchArray) => {
                    const interval = parseInt(match[1]);
                    const period = match[2].replace(/s$/, '').toLowerCase();
                    const freqMap: Record<string, string> = {
                        'day': 'DAILY',
                        'week': 'WEEKLY', 
                        'month': 'MONTHLY',
                        'year': 'YEARLY'
                    };
                    return `FREQ=${freqMap[period]};INTERVAL=${interval}`;
                }
            },
            // "every other period" (e.g., "every other week")
            {
                regex: /\bevery\s+other\s+(day|week|month|year)\b/i,
                handler: (match: RegExpMatchArray) => {
                    const period = match[1].toLowerCase();
                    const freqMap: Record<string, string> = {
                        'day': 'DAILY',
                        'week': 'WEEKLY',
                        'month': 'MONTHLY', 
                        'year': 'YEARLY'
                    };
                    return `FREQ=${freqMap[period]};INTERVAL=2`;
                }
            },
            // "every [weekday]" - ONLY with explicit "every" keyword
            {
                regex: /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
                handler: (match: RegExpMatchArray) => {
                    const day = match[1].toUpperCase().substring(0, 2);
                    return `FREQ=WEEKLY;BYDAY=${day}`;
                }
            },
            // Plural weekdays (e.g., "mondays", "tuesdays") - only plurals indicate recurrence
            {
                regex: /\b(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i,
                handler: (match: RegExpMatchArray) => {
                    const day = match[1].replace(/s$/, '').toUpperCase().substring(0, 2);
                    return `FREQ=WEEKLY;BYDAY=${day}`;
                }
            },
            // General frequencies
            { regex: /\b(daily|every day)\b/i, handler: () => 'FREQ=DAILY' },
            { regex: /\b(weekly|every week)\b/i, handler: () => 'FREQ=WEEKLY' },
            { regex: /\b(monthly|every month)\b/i, handler: () => 'FREQ=MONTHLY' },
            { regex: /\b(yearly|annually|every year)\b/i, handler: () => 'FREQ=YEARLY' }
        ];

        for (const pattern of recurrencePatterns) {
            const match = text.match(pattern.regex);
            if (match) {
                const rruleString = pattern.handler(match);
                // Validate the rrule string before setting it
                if (this.isValidRRuleString(rruleString)) {
                    result.recurrence = rruleString;
                    return this.cleanupWhitespace(text.replace(pattern.regex, ''));
                }
            }
        }

        return text;
    }

    /**
     * Validate an rrule string to prevent parsing errors
     */
    private isValidRRuleString(rruleString: string): boolean {
        // Check for empty or undefined BYDAY values
        if (rruleString.includes('BYDAY=undefined') || rruleString.includes('BYDAY=;') || rruleString.includes('BYDAY=')) {
            const byDayMatch = rruleString.match(/BYDAY=([^;]*)/);
            if (byDayMatch && (!byDayMatch[1] || byDayMatch[1] === 'undefined' || byDayMatch[1].trim() === '')) {
                return false;
            }
        }
        
        // Check for basic FREQ requirement
        if (!rruleString.includes('FREQ=')) {
            return false;
        }
        
        return true;
    }

    /** Extracts time estimates like "30min", "1h", "1h30m" from the text. */
    private extractTimeEstimate(text: string, result: ParsedTaskData): string {
        // Match patterns like "30min", "1h", "1h30m", "1.5h", etc.
        const estimateRegex = /\b(\d+(\.\d+)?\s*(h|hr|hour|hours)(\s*and\s*|\s*)?\d*\s*(m|min|minute|minutes)?|\d+\s*(m|min|minute|minutes))\b/i;
        const match = text.match(estimateRegex);
        
        if (match) {
            const estimateText = match[0].toLowerCase();
            let minutes = 0;
            
            // Extract hours
            const hourMatch = estimateText.match(/(\d+(\.\d+)?)\s*(h|hr|hour|hours)/);
            if (hourMatch) {
                minutes += parseFloat(hourMatch[1]) * 60;
            }
            
            // Extract minutes
            const minuteMatch = estimateText.match(/(\d+)\s*(m|min|minute|minutes)/);
            if (minuteMatch) {
                minutes += parseInt(minuteMatch[1]);
            }
            
            if (minutes > 0) {
                result.estimate = minutes;
                return this.cleanupWhitespace(text.replace(estimateRegex, ''));
            }
        }
        
        return text;
    }

    /** Parses dates and times from the text using chrono-node. */
    private parseDatesAndTimes(text: string, result: ParsedTaskData): string {
        let workingText = text;
        const customDateFields = this.settings.customFields.filter(f => f.type === 'date');

        // Process custom date fields first
        for (const field of customDateFields) {
            // Only attempt to parse if the custom field hasn't been set yet by extractCustomFields
            if (!result.customFields[field.name]) {
                const datePattern = new RegExp(`\\b${field.name}\\s+([\\w\\s]+?(tomorrow|today|yesterday|next week|last week|on \\d{1,2}/\\d{1,2}(/\\d{2,4})?|\\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \\d{1,2}|\\d{4}-\\d{2}-\\d{2}))\\b`, 'i');
                const match = workingText.match(datePattern);
                if (match) {
                    const parsedDate = chrono.parseDate(match[1]);
                    if (parsedDate) {
                        result.customFields[field.name] = parsedDate.toISOString().split('T')[0];
                        workingText = workingText.replace(match[0], '');
                    }
                }
            }
        }

        // Then process general due dates (only if task management properties are enabled)
        if (this.settings.taskManagementProperties.enabled) {
            // Check for 'due <date pattern>' first
            const duePattern = /due\s+(.+)/i;
            const dueMatch = workingText.match(duePattern);
            let chronoResults;

            if (dueMatch) {
                chronoResults = chrono.parse(dueMatch[1]);
            } else {
                chronoResults = chrono.parse(workingText);
            }
            
            if (chronoResults.length > 0) {
                // Sort by index to process from right to left (to avoid text shifting issues)
                chronoResults.sort((a, b) => b.index - a.index);
                
                // Process the first remaining date as the due date
                const firstDate = chronoResults[0];
                const date = firstDate.start.date();
                
                // Format date as YYYY-MM-DD
                const formattedDate = date.toISOString().split('T')[0];
                
                // Format time as HH:MM if present
                let formattedTime: string | undefined;
                if (firstDate.start.isCertain('hour')) {
                    const hours = date.getHours().toString().padStart(2, '0');
                    const minutes = date.getMinutes().toString().padStart(2, '0');
                    formattedTime = `${hours}:${minutes}`;
                }
                
                // Assign to due date/time
                result.dueDate = formattedDate;
                if (formattedTime) {
                    result.dueTime = formattedTime;
                }
                
                // Remove the date text from the working text
                const dateText = workingText.substring(firstDate.index, firstDate.index + firstDate.text.length);
                workingText = this.cleanupWhitespace(workingText.replace(dateText, ''));
                
                return workingText;
            }
        }
        
        return workingText;
    }

    /**
     * Cleans up extra whitespace from a string.
     */
    private cleanupWhitespace(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Generates preview data for the UI based on parsed task data.
     */
    public getPreviewData(parsed: ParsedTaskData, customFields: CustomField[]): Array<{text: string}> {
        const previewItems: {text: string}[] = [];
        
        // Due date/time
        if (parsed.dueDate) {
            let dueText = `Due: ${parsed.dueDate}`;
            if (parsed.dueTime) {
                dueText += ` ${parsed.dueTime}`;
            }
            previewItems.push({ text: dueText });
        }
        
        
        // Tags
        if (parsed.tags.length > 0) {
            previewItems.push({ text: `Tags: ${parsed.tags.join(', ')}` });
        }
        
        // Time estimate
        if (parsed.estimate) {
            const hours = Math.floor(parsed.estimate / 60);
            const minutes = parsed.estimate % 60;
            let estimateText = 'Estimate: ';
            if (hours > 0) {
                estimateText += `${hours}h`;
                if (minutes > 0) {
                    estimateText += ` ${minutes}m`;
                }
            } else {
                estimateText += `${minutes}m`;
            }
            previewItems.push({ text: estimateText });
        }
        
        // Recurrence
        if (parsed.recurrence) {
            let recurrenceText = 'Invalid recurrence';
            try {
                // Ensure it's a valid RRule before trying to parse
                if (parsed.recurrence.includes('FREQ=') && this.isValidRRuleString(parsed.recurrence)) {
                    recurrenceText = RRule.fromString(parsed.recurrence).toText();
                }
            } catch (error) {
                console.debug('Error parsing rrule for preview:', error);
            }
            previewItems.push({ text: `Recurrence: ${recurrenceText}` });
        }

        // Custom fields
        if (parsed.customFields && Object.keys(parsed.customFields).length > 0) {
            for (const [fieldName, fieldValue] of Object.entries(parsed.customFields)) {
                previewItems.push({ text: `${fieldName}: ${fieldValue}` });
            }
        }
        
        return previewItems;
    }
}