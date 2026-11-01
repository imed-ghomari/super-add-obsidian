import * as chrono from 'chrono-node';
import type { ParsedResult } from 'chrono-node';
import { RRule } from 'rrule';
import { CustomField, FrontmatterValue, SuperAddSettings } from '../settings';

/**
 * Zero-pads a number to two digits without relying on ES2017 String.padStart,
 * so the code type-checks against older lib targets as well.
 */
function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The kind of value a recognised span produced. The names double as CSS
 * modifier suffixes in the task creation dialog, e.g. `super-add-highlight--due`.
 */
export type ParsedSpanKind =
    | 'tag'
    | 'template'
    | 'field'
    | 'status'
    | 'priority'
    | 'recurrence'
    | 'estimate'
    | 'scheduled'
    | 'due';

export interface ParsedSpan {
    kind: ParsedSpanKind;
    /** Offset in the original input, in UTF-16 code units. */
    start: number;
    end: number;
    /** The text covered by the span in the original input. */
    text: string;
    /** The custom property name, for `field`, `status` and `priority` spans. */
    field?: string;
}

export interface ParsedTaskResult {
    data: ParsedTaskData;
    spans: ParsedSpan[];
}

export interface ParsedTaskData {
    title: string;
    details?: string;
    dueDate?: string;
    scheduledDate?: string;
    dueTime?: string;
    scheduledTime?: string;
    tags: string[];
    estimate?: number; // in minutes
    customFields: Record<string, FrontmatterValue>;
    template?: string;
    recurrence?: string; // For storing recurrence rules
}

/**
 * A string plus a map from each character back to its position in the original
 * input. Parsing removes pieces of text as they are recognised; carrying the
 * map lets us report where each recognised piece was in the user's input.
 */
class TrackedText {
    public text: string;
    public readonly spans: ParsedSpan[] = [];
    private mapping: number[];
    private readonly source: string;

    constructor(source: string, text: string, offset: number) {
        this.source = source;
        this.text = text;
        this.mapping = [];
        for (let index = 0; index < text.length; index++) {
            this.mapping.push(offset + index);
        }
    }

    public remove(start: number, end: number): void {
        if (start < 0 || end <= start || end > this.text.length) {
            return;
        }

        this.text = this.text.substring(0, start) + this.text.substring(end);
        this.mapping.splice(start, end - start);
    }

    /**
     * Collapse whitespace exactly like the parser used to, but keep the map in
     * sync so later matches still point at the right input offsets.
     */
    public cleanup(): void {
        let cleaned = '';
        const cleanedMapping: number[] = [];
        let index = 0;

        while (index < this.text.length) {
            const character = this.text.charAt(index);
            if (/\s/.test(character)) {
                let runEnd = index;
                while (runEnd < this.text.length && /\s/.test(this.text.charAt(runEnd))) {
                    runEnd++;
                }

                if (cleaned.length > 0 && runEnd < this.text.length) {
                    cleaned += ' ';
                    cleanedMapping.push(this.mapping[index]);
                }
                index = runEnd;
                continue;
            }

            cleaned += character;
            cleanedMapping.push(this.mapping[index]);
            index++;
        }

        this.text = cleaned;
        this.mapping = cleanedMapping;
    }

    public claim(start: number, end: number, kind: ParsedSpanKind, field?: string): void {
        if (start < 0 || end <= start || end > this.text.length) {
            return;
        }

        const originalStart = this.mapping[start];
        const originalEnd = this.mapping[end - 1] + 1;
        if (originalStart === undefined || originalEnd <= originalStart) {
            return;
        }

        const span: ParsedSpan = {
            kind,
            start: originalStart,
            end: originalEnd,
            text: this.source.substring(originalStart, originalEnd)
        };

        if (field) {
            span.field = field;
        }

        this.spans.push(span);
    }

    public claimAndRemove(
        start: number,
        end: number,
        kind: ParsedSpanKind,
        field?: string
    ): void {
        this.claim(start, end, kind, field);
        this.remove(start, end);
        this.cleanup();
    }
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
        return this.parseInputWithSpans(input).data;
    }

    /**
     * Parse natural language input and report which parts of the input were
     * recognised. The spans refer to the original input, including the first
     * line only, and are safe to use for highlighting.
     */
    public parseInputWithSpans(input: string): ParsedTaskResult {
        const result: ParsedTaskData = {
            title: '',
            tags: [],
            customFields: {}
        };

        const titleParts = this.extractTitleAndDetails(input);
        if (titleParts.details) {
            result.details = titleParts.details;
        }

        const tracked = new TrackedText(input, titleParts.titleLine, titleParts.offset);

        // Extract tags (only #tags are supported).
        this.extractTags(tracked, result);

        // Extract custom properties before template names, so a template name
        // inside a link or property value cannot be mistaken for a template.
        this.extractCustomFields(tracked, result);

        // Extract template name.
        this.extractTemplate(tracked, result);

        // Extract recurrence before dates to prevent chrono from consuming keywords.
        if (this.settings.taskManagementProperties.enabled) {
            this.extractRecurrence(tracked, result);
        }

        // Extract dates and times.
        this.parseDatesAndTimes(tracked, result);

        // Extract time estimate.
        this.extractTimeEstimate(tracked, result);

        // The remainder is the title.
        result.title = this.cleanupTitle(tracked.text);

        return {
            data: result,
            spans: this.normalizeSpans(tracked.spans, input.length)
        };
    }

    /**
     * Remove separators and empty brackets left behind when a value is taken
     * out of the title, then collapse the remaining whitespace.
     */
    private cleanupTitle(text: string): string {
        let cleaned = text.trim();

        cleaned = cleaned.replace(/\s*\(\s*\)/g, '');
        cleaned = cleaned.replace(/\s*\[\s*\]/g, '');
        cleaned = cleaned.replace(/\s*\{\s*\}/g, '');

        // A comma or semicolon floating on its own was a separator around a
        // removed value. Normal punctuation such as "milk, eggs" is untouched.
        cleaned = cleaned.replace(/\s+[,;]\s*(?=\s|$)/g, ' ');
        cleaned = cleaned.replace(/^[,;]\s*/, '');
        cleaned = cleaned.replace(/\s*[,;]$/, '');

        return cleaned.replace(/\s+/g, ' ').trim();
    }

    /**
     * Splits the input into the first line (parsed) and the rest (details).
     * Returns the offset of the first line in the original input.
     */
    private extractTitleAndDetails(input: string): {
        titleLine: string;
        details?: string;
        offset: number;
    } {
        const trimmedInput = input.trim();
        if (!trimmedInput) {
            return { titleLine: '', offset: 0 };
        }

        const trimmedStart = input.indexOf(trimmedInput);
        const firstLineBreak = trimmedInput.indexOf('\n');
        const titleLine = firstLineBreak === -1
            ? trimmedInput
            : trimmedInput.substring(0, firstLineBreak).trim();
        const details = firstLineBreak === -1
            ? undefined
            : trimmedInput.substring(firstLineBreak + 1).trim();

        return {
            titleLine,
            details: details || undefined,
            offset: trimmedStart === -1 ? 0 : trimmedStart
        };
    }

    /** Extracts #tags from the text and adds them to the result object. */
    private extractTags(tracked: TrackedText, result: ParsedTaskData): void {
        const tagPattern = /#[\w/]+/g;
        const matches: RegExpExecArray[] = [];
        let match: RegExpExecArray | null;

        while ((match = tagPattern.exec(tracked.text)) !== null) {
            matches.push(match);
            if (match[0].length === 0) {
                tagPattern.lastIndex++;
            }
        }

        for (const tagMatch of matches) {
            result.tags.push(tagMatch[0].substring(1));
            tracked.claim(tagMatch.index, tagMatch.index + tagMatch[0].length, 'tag');
        }

        for (let index = matches.length - 1; index >= 0; index--) {
            const tagMatch = matches[index];
            tracked.remove(tagMatch.index, tagMatch.index + tagMatch[0].length);
        }

        tracked.cleanup();
    }

    /**
     * Extracts a template name from the text and adds it to the result object.
     */
    private extractTemplate(tracked: TrackedText, result: ParsedTaskData): void {
        if (!this.settings.templates || this.settings.templates.length === 0) {
            return;
        }

        for (const template of this.settings.templates) {
            const match = this.findTemplateMatch(tracked.text, template.name);
            if (!match) {
                continue;
            }

            result.template = template.name;
            tracked.claimAndRemove(
                match.index,
                match.index + match[0].length,
                'template'
            );
            break;
        }
    }

    /**
     * Find a template name outside wikilinks, so a link such as
     * `[[Project note]]` cannot be mistaken for the "project" template.
     */
    private findTemplateMatch(text: string, templateName: string): RegExpExecArray | null {
        const templatePattern = new RegExp(
            `\\b${escapeRegExp(templateName)}\\b`,
            'gi'
        );
        let match: RegExpExecArray | null;

        while ((match = templatePattern.exec(text)) !== null) {
            if (!this.isInsideWikilink(text, match.index)) {
                return match;
            }
        }

        return null;
    }

    private isInsideWikilink(text: string, index: number): boolean {
        const openIndex = text.lastIndexOf('[[', index);
        if (openIndex === -1) {
            return false;
        }

        const closeIndex = text.indexOf(']]', openIndex + 2);
        return closeIndex !== -1 && index < closeIndex;
    }

    /**
     * Extracts custom fields from the text based on defined custom field settings.
     * Handles all field types with proper natural language recognition.
     */
    private extractCustomFields(tracked: TrackedText, result: ParsedTaskData): void {
        for (const field of this.settings.customFields) {
            if (field.type === 'boolean') {
                this.extractBooleanField(tracked, result, field);
            } else if (field.type === 'date') {
                this.extractDateField(tracked, result, field, false);
            } else if (field.type === 'datetime') {
                this.extractDateField(tracked, result, field, true);
            } else if (field.type === 'string') {
                this.extractStringField(tracked, result, field);
            } else if (field.type === 'number') {
                this.extractNumberField(tracked, result, field);
            } else if (field.type === 'array') {
                this.extractArrayField(tracked, result, field);
            }
        }

        tracked.cleanup();
    }

    private extractBooleanField(
        tracked: TrackedText,
        result: ParsedTaskData,
        field: CustomField
    ): void {
        const booleanPattern = new RegExp(
            `\\b${escapeRegExp(field.name)}\\s+(true|false)\\b`,
            'i'
        );
        const match = booleanPattern.exec(tracked.text);
        if (!match) {
            return;
        }

        result.customFields[field.name] = match[1].toLowerCase() === 'true';
        tracked.claimAndRemove(
            match.index,
            match.index + match[0].length,
            this.getFieldSpanKind(field),
            field.name
        );
    }

    private extractDateField(
        tracked: TrackedText,
        result: ParsedTaskData,
        field: CustomField,
        includeTime: boolean
    ): void {
        const datePattern = new RegExp(`\\b${escapeRegExp(field.name)}\\s+(.+)`, 'i');
        const match = datePattern.exec(tracked.text);
        if (!match) {
            return;
        }

        const valueStart = match.index + match[0].length - match[1].length;
        const chronoResults = chrono.parse(match[1]);
        if (chronoResults.length === 0) {
            return;
        }

        const firstResult = chronoResults[0];
        const parsedDate = firstResult.start.date();
        result.customFields[field.name] = includeTime
            ? parsedDate.toISOString()
            : parsedDate.toISOString().split('T')[0];

        tracked.claimAndRemove(
            match.index,
            valueStart + firstResult.index + firstResult.text.length,
            this.getFieldSpanKind(field),
            field.name
        );
    }

    private extractStringField(
        tracked: TrackedText,
        result: ParsedTaskData,
        field: CustomField
    ): void {
        if (field.defaultValue) {
            const definedValues = field.defaultValue.split(',').map(value => value.trim());
            const best = this.findBestDefinedValueMatch(tracked.text, definedValues, field.useRegex);
            if (!best) {
                return;
            }

            const matchStart = this.includeFieldNamePrefix(
                tracked.text,
                best.match.index,
                field.name
            );
            result.customFields[field.name] = best.match[0];
            tracked.claimAndRemove(
                matchStart,
                best.match.index + best.match[0].length,
                this.getFieldSpanKind(field),
                field.name
            );
            return;
        }

        const stringPattern = new RegExp(
            `\\b${escapeRegExp(field.name)}\\s+([^\\s]+(?:\\s+[^\\s]+)*?)(?=\\s+\\w+:|$)`,
            'i'
        );
        const match = stringPattern.exec(tracked.text);
        if (!match) {
            return;
        }

        result.customFields[field.name] = match[1].trim();
        tracked.claimAndRemove(
            match.index,
            match.index + match[0].length,
            this.getFieldSpanKind(field),
            field.name
        );
    }

    private extractNumberField(
        tracked: TrackedText,
        result: ParsedTaskData,
        field: CustomField
    ): void {
        const numberPattern = new RegExp(
            `\\b${escapeRegExp(field.name)}\\s+(\\d+(\\.\\d+)?)\\b`,
            'i'
        );
        const match = numberPattern.exec(tracked.text);
        if (!match) {
            return;
        }

        result.customFields[field.name] = parseFloat(match[1]);
        tracked.claimAndRemove(
            match.index,
            match.index + match[0].length,
            this.getFieldSpanKind(field),
            field.name
        );
    }

    private extractArrayField(
        tracked: TrackedText,
        result: ParsedTaskData,
        field: CustomField
    ): void {
        if (!field.defaultValue) {
            const arrayPattern = new RegExp(
                `\\b${escapeRegExp(field.name)}\\s+([\\w\\s,]+)\\b`,
                'i'
            );
            const match = arrayPattern.exec(tracked.text);
            if (!match) {
                return;
            }

            result.customFields[field.name] = match[1]
                .split(',')
                .map(item => item.trim());
            tracked.claimAndRemove(
                match.index,
                match.index + match[0].length,
                this.getFieldSpanKind(field),
                field.name
            );
            return;
        }

        const remainingValues = field.defaultValue.split(',').map(value => value.trim());
        const matchedValues: string[] = [];

        // Pick the earliest match among the remaining defined values on each
        // pass. This keeps overlapping values such as "working" and "not
        // working" correct instead of depending on their order in settings.
        while (remainingValues.length > 0) {
            const best = this.findBestDefinedValueMatch(
                tracked.text,
                remainingValues,
                field.useRegex
            );
            if (!best) {
                break;
            }

            const matchStart = this.includeFieldNamePrefix(
                tracked.text,
                best.match.index,
                field.name
            );
            matchedValues.push(best.match[0]);
            tracked.claimAndRemove(
                matchStart,
                best.match.index + best.match[0].length,
                this.getFieldSpanKind(field),
                field.name
            );
            remainingValues.splice(remainingValues.indexOf(best.value), 1);
        }

        if (matchedValues.length > 0) {
            result.customFields[field.name] = matchedValues;
        }
    }

    /**
     * Find the match that starts earliest in the text. At the same position the
     * longest match wins, so a defined value such as "not working" is not
     * shortened to "working" by another value in the same list.
     */
    private findBestDefinedValueMatch(
        text: string,
        definedValues: string[],
        useRegex?: boolean
    ): { match: RegExpExecArray; value: string } | null {
        let best: { match: RegExpExecArray; value: string } | null = null;

        for (const value of definedValues) {
            if (!value) {
                continue;
            }

            const valuePattern = this.createValuePattern(value, useRegex);
            const match = valuePattern.exec(text);
            if (!match || match[0].length === 0) {
                continue;
            }

            if (
                !best
                || match.index < best.match.index
                || (match.index === best.match.index && match[0].length > best.match[0].length)
            ) {
                best = { match, value };
            }
        }

        return best;
    }

    private createValuePattern(value: string, useRegex?: boolean): RegExp {
        if (useRegex) {
            try {
                return new RegExp(value, 'i');
            } catch {
                // If regex is invalid, fall back to literal matching.
            }
        }

        return new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i');
    }

    /**
     * If the text immediately before a matched value is the property name, the
     * whole phrase is recognised. This stops "status done" from leaving
     * "status" in the title while still allowing bare values such as "done".
     */
    private includeFieldNamePrefix(text: string, valueStart: number, fieldName: string): number {
        const beforeValue = text.substring(0, valueStart);
        const prefixPattern = new RegExp(
            `(^|\\s)${escapeRegExp(fieldName)}\\s+$`,
            'i'
        );
        const match = prefixPattern.exec(beforeValue);
        if (!match) {
            return valueStart;
        }

        return match.index + match[1].length;
    }

    private getFieldSpanKind(field: CustomField): ParsedSpanKind {
        const name = field.name.toLowerCase();
        if (name === 'status') {
            return 'status';
        }
        if (name === 'priority') {
            return 'priority';
        }
        if (name === 'scheduled') {
            return 'scheduled';
        }

        const taskProperties = this.settings.taskManagementProperties;
        if (taskProperties.enabled) {
            if (name === taskProperties.duePropertyName.toLowerCase()) {
                return 'due';
            }
            if (name === taskProperties.recurrencePropertyName.toLowerCase()) {
                return 'recurrence';
            }
        }

        return 'field';
    }

    /**
     * Extracts recurrence from text and generates rrule strings using a
     * declarative pattern map.
     */
    private extractRecurrence(tracked: TrackedText, result: ParsedTaskData): void {
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
            const match = pattern.regex.exec(tracked.text);
            if (!match) {
                continue;
            }

            const rruleString = pattern.handler(match);
            if (!this.isValidRRuleString(rruleString)) {
                continue;
            }

            result.recurrence = rruleString;
            tracked.claimAndRemove(
                match.index,
                match.index + match[0].length,
                'recurrence'
            );
            return;
        }
    }

    /**
     * Validate an rrule string to prevent parsing errors.
     */
    private isValidRRuleString(rruleString: string): boolean {
        // Check for empty or undefined BYDAY values.
        if (rruleString.includes('BYDAY=undefined') || rruleString.includes('BYDAY=;') || rruleString.includes('BYDAY=')) {
            const byDayMatch = rruleString.match(/BYDAY=([^;]*)/);
            if (byDayMatch && (!byDayMatch[1] || byDayMatch[1] === 'undefined' || byDayMatch[1].trim() === '')) {
                return false;
            }
        }

        // Check for basic FREQ requirement.
        if (!rruleString.includes('FREQ=')) {
            return false;
        }

        return true;
    }

    /** Extracts time estimates like "30min", "1h", "1h30m" from the text. */
    private extractTimeEstimate(tracked: TrackedText, result: ParsedTaskData): void {
        // Match patterns like "30min", "1h", "1h30m", "1.5h", etc.
        const estimateRegex = /\b(\d+(\.\d+)?\s*(h|hr|hour|hours)(\s*and\s*|\s*)?\d*\s*(m|min|minute|minutes)?|\d+\s*(m|min|minute|minutes))\b/i;
        const match = estimateRegex.exec(tracked.text);
        if (!match) {
            return;
        }

        const estimateText = match[0].toLowerCase();
        let minutes = 0;

        // Extract hours.
        const hourMatch = estimateText.match(/(\d+(\.\d+)?)\s*(h|hr|hour|hours)/);
        if (hourMatch) {
            minutes += parseFloat(hourMatch[1]) * 60;
        }

        // Extract minutes.
        const minuteMatch = estimateText.match(/(\d+)\s*(m|min|minute|minutes)/);
        if (minuteMatch) {
            minutes += parseInt(minuteMatch[1]);
        }

        if (minutes > 0) {
            result.estimate = minutes;
            tracked.claimAndRemove(
                match.index,
                match.index + match[0].length,
                'estimate'
            );
        }
    }

    /** Parses dates and times from the text using chrono-node. */
    private parseDatesAndTimes(tracked: TrackedText, result: ParsedTaskData): void {
        const customDateFields = this.settings.customFields.filter(field => field.type === 'date');

        // Process custom date fields first.
        for (const field of customDateFields) {
            // Only attempt to parse if the custom field hasn't been set yet by extractCustomFields.
            if (result.customFields[field.name]) {
                continue;
            }

            const datePattern = new RegExp(
                `\\b${escapeRegExp(field.name)}\\s+([\\w\\s]+?(tomorrow|today|yesterday|next week|last week|on \\d{1,2}/\\d{1,2}(/\\d{2,4})?|\\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \\d{1,2}|\\d{4}-\\d{2}-\\d{2}))\\b`,
                'i'
            );
            const match = datePattern.exec(tracked.text);
            if (!match) {
                continue;
            }

            const parsedDate = chrono.parseDate(match[1]);
            if (!parsedDate) {
                continue;
            }

            result.customFields[field.name] = parsedDate.toISOString().split('T')[0];
            tracked.claimAndRemove(
                match.index,
                match.index + match[0].length,
                this.getFieldSpanKind(field),
                field.name
            );
        }

        // Then process general due dates (only if task management properties are enabled).
        if (!this.settings.taskManagementProperties.enabled) {
            return;
        }

        const duePattern = /\bdue\s+(.+)/i;
        const dueMatch = duePattern.exec(tracked.text);
        let chronoResults: ParsedResult[];
        let dueTriggerStart = -1;
        let valueStart = 0;

        if (dueMatch) {
            valueStart = dueMatch.index + dueMatch[0].length - dueMatch[1].length;
            chronoResults = chrono.parse(dueMatch[1]);
            if (chronoResults.length > 0) {
                dueTriggerStart = dueMatch.index;
            }
        } else {
            chronoResults = chrono.parse(tracked.text);
        }

        // A due trigger without a usable date ("due by phone") should still let
        // a later implicit date be found, matching the previous fallback.
        if (dueMatch && chronoResults.length === 0) {
            chronoResults = chrono.parse(tracked.text);
        }

        if (chronoResults.length === 0) {
            return;
        }

        // Keep the previous preference for the right-most date when more than
        // one is present.
        chronoResults.sort((a, b) => b.index - a.index);
        const firstDate: ParsedResult = chronoResults[0];
        const date: Date = firstDate.start.date();

        // Format date as YYYY-MM-DD.
        const formattedDate = date.toISOString().split('T')[0];

        // Format time as HH:MM if present.
        let formattedTime: string | undefined;
        if (firstDate.start.isCertain('hour')) {
            const hours = pad2(date.getHours());
            const minutes = pad2(date.getMinutes());
            formattedTime = `${hours}:${minutes}`;
        }

        result.dueDate = formattedDate;
        if (formattedTime) {
            result.dueTime = formattedTime;
        }

        const matchStart = dueTriggerStart === -1
            ? firstDate.index
            : dueTriggerStart;
        const dateEnd = dueTriggerStart === -1
            ? firstDate.index + firstDate.text.length
            : valueStart + firstDate.index + firstDate.text.length;

        // Remove the trigger (when present) and the date text from the working text.
        tracked.claimAndRemove(matchStart, dateEnd, 'due');
    }

    /**
     * Sort spans in input order and drop any overlaps, so the highlighter can
     * render them as a simple, non-nested list.
     */
    private normalizeSpans(spans: ParsedSpan[], inputLength: number): ParsedSpan[] {
        const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
        const normalized: ParsedSpan[] = [];
        let lastEnd = -1;

        for (const span of sorted) {
            if (span.start < lastEnd || span.end <= span.start || span.end > inputLength) {
                continue;
            }

            normalized.push(span);
            lastEnd = span.end;
        }

        return normalized;
    }

    /**
     * Generates preview data for the UI based on parsed task data.
     */
    public getPreviewData(parsed: ParsedTaskData, customFields: CustomField[]): Array<{ text: string }> {
        const previewItems: { text: string }[] = [];

        // Due date/time.
        if (parsed.dueDate) {
            let dueText = `Due: ${parsed.dueDate}`;
            if (parsed.dueTime) {
                dueText += ` ${parsed.dueTime}`;
            }
            previewItems.push({ text: dueText });
        }

        // Tags.
        if (parsed.tags.length > 0) {
            previewItems.push({ text: `Tags: ${parsed.tags.join(', ')}` });
        }

        // Time estimate.
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

        // Recurrence.
        if (parsed.recurrence) {
            let recurrenceText = 'Invalid recurrence';
            try {
                // Ensure it's a valid RRule before trying to parse.
                if (parsed.recurrence.includes('FREQ=') && this.isValidRRuleString(parsed.recurrence)) {
                    recurrenceText = RRule.fromString(parsed.recurrence).toText();
                }
            } catch {
                // Keep the 'Invalid recurrence' fallback text.
            }
            previewItems.push({ text: `Recurrence: ${recurrenceText}` });
        }

        // Custom fields.
        if (parsed.customFields && Object.keys(parsed.customFields).length > 0) {
            for (const fieldName of Object.keys(parsed.customFields)) {
                const fieldValue: FrontmatterValue = parsed.customFields[fieldName];
                const fieldText = Array.isArray(fieldValue) ? fieldValue.join(', ') : String(fieldValue);
                previewItems.push({ text: `${fieldName}: ${fieldText}` });
            }
        }

        return previewItems;
    }
}
