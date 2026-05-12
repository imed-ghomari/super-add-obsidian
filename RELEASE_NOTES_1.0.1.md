## What's Changed

- fixed Obsidian review errors around runtime style injection and direct inline style mutations
- moved modal layout styling into `styles.css` for better theming and compatibility
- updated settings UI to use Obsidian heading settings and cleaned up async handling
- tightened TypeScript types to remove unsafe `any` usage across parsing, template loading, and Templater integration
- aligned release metadata across `manifest.json`, `package.json`, and `versions.json`
- replaced `builtin-modules` with Node's built-in `module` API in the build config
- added a GitHub Actions release workflow that uploads assets, generates release notes, and creates artifact attestations

## Compatibility

- bumped `minAppVersion` to `1.4.0` to match the Obsidian APIs used by the plugin
