## What's Changed

- updated the GitHub Actions release workflow to use `actions/checkout@v6` and `actions/setup-node@v6`
- moved the workflow to Node 24-compatible action runtimes
- made the release version check print both manifest and tag versions for easier debugging
- normalized the tag comparison so both `1.0.4` and `v1.0.4` style tags work

## Notes

- this release is intended to fix the failed automatic release workflow from `1.0.3`
