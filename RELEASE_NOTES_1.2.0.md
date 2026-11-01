## SuperAdd 1.2.0 — see what SuperAdd recognizes

Your task line now shows what SuperAdd has understood while you type. Recognized values get a subtle colored background, so you can catch a missed property or date before saving.

### What's new for you
- **Live highlighting in the task description**: dates, recurrence, status, estimates, templates, and custom properties are marked as you type. The text stays fully editable; normal text color, caret, selection, and scrolling are unchanged.
- **Color key**: due and scheduled dates are blue, recurrence is purple, status is green, priority is red, time estimates are orange, templates are cyan, and other custom properties use the accent color.
- **Works with your own properties**: highlighting uses the names and values from Settings → Properties, including arrays such as `context inside pc, outside pc` and regex values such as dependency links.
- **Templates stay visible**: type a template name and it is highlighted; its frontmatter preview still appears below.

### Parsing fixes that keep the preview honest
These fixes make the highlighted text match the task that is actually saved:
- A `due` keyword no longer eats part of the title.
- Property names are removed with their values, so they do not remain in the title.
- Leftover commas and empty brackets are cleaned up.
- Template names inside `[[wikilinks]]` are no longer mistaken for templates.
- Custom property values are recognized before template names.
- Overlapping status values such as `not working` and `not done` are matched in full.

### How to try it
1. Update to 1.2.0.
2. Open **Create Task**.
3. Type a line such as:
   `Fix login bug context inside pc status not working start tomorrow 9am scheduled next week due friday process`
4. Check the highlighted parts and the preview, then save.

### Compatibility
- No settings or template changes are needed. Existing custom properties, regex values, and templates keep working.
- Requires Obsidian 1.13.1 or newer.

### Action needed
- None. Just update.
