# Changelog — monorepo lane

Every `@copilotkit/*` package listed under `scopes.monorepo` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

The other release lanes keep their own file:
[`packages/angular/CHANGELOG.md`](packages/angular/CHANGELOG.md) and
[`packages/channels/CHANGELOG.md`](packages/channels/CHANGELOG.md).

Entries begin with the first release cut after this file was added. Earlier
releases have no changelog: the per-package files from the changesets era stopped
at `1.55.2` while the lane shipped `1.69.3`, and they are recoverable from git
history (for example `git show v1.69.3:packages/core/CHANGELOG.md`).
