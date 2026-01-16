# SuperAdd for Obsidian

Create richly structured tasks from a single natural language line. SuperAdd recognizes your custom properties, applies templates, and writes clean frontmatter with correct ordering.

## Highlights

- **Natural language parsing** for title, tags, time estimate, due date/time, scheduled date/time, and recurrence.
- **Custom properties** (string, number, boolean, array, date, datetime) recognized inline by name or value.
- **Template support** with frontmatter merge:
  - All template properties are written to the new file.
  - Properties filled via the modal/NLP override the template.
  - Unfilled template properties are written as `key:` (null).
  - The frontmatter order matches the template order; non-template keys are appended.
- **Live preview** with pill-style property display.
- **Quick link insertion**: type `-` to open a file picker and insert `[[links]]`.

## How it works

1. Define properties in Settings → Properties (supports regex for strings/arrays).
2. Optionally add templates in Settings → Templates (frontmatter-driven).
3. Open “Create Task”, type your line (e.g., “Call Alex tomorrow 3pm context office due next week”).
4. SuperAdd parses NLP, matches custom properties, applies the selected template, and creates the file.

### Dates and recurrence
- “Due” uses a robust NLP pass (e.g., “tomorrow”, “in 2 days evening”).
- Custom date/datetime properties use the same recognition and reset correctly afterward.
- Recurrence is recognized from natural phrases (e.g., “every week”, “every second Monday”) into RRULE.

## Examples

- “Write report due tomorrow 14:00 estimate 45m #work context office”
- “Team sync meeting next Fri 3pm recurrence every week”
- “Project kickoff status open priority high context client-office”

## Configuration

- **Default folder** for created notes.
- **Task management properties**: set the field names for due and recurrence.
- **Custom properties**: add/edit types, defaults, and optional regex/defined values.
- **Templates**: pick markdown files with frontmatter; their keys define desired frontmatter.

## Tips

- Put all desired properties as frontmatter keys in your template. SuperAdd will write them all and keep order.
- Use concise names for properties to make inline recognition natural.
- Use regex sparingly for precision on string/array properties.

## Troubleshooting

- Properties not filled: check the property names in Settings match your input phrasing.
- Template not applied: verify the template is selected/recognized and has frontmatter.
- Date not parsed: try more explicit phrases (e.g., “tomorrow 18:00”, “next Monday morning”).

## Build / Dev

```bash
npm install
npm run dev   # watch
npm run build # production
```

MIT License.