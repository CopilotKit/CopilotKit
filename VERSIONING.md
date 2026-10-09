# Versioning and breaking changes

This document tells you how CopilotKit marks breaking changes, how long deprecated APIs stay, and where to find migration steps.

A breaking change is a change that can stop working code from building or running after an upgrade. Examples are a removed export, a renamed prop, a changed default, or a new required argument.

## Release scopes

The packages release in groups called scopes. Each scope has its own version number. The scopes are in `release.config.json`:

- `monorepo`: the main `@copilotkit/*` packages, released together at one version.
- `angular`: `@copilotkit/angular`, a 0.x package.
- `channels`: the channel packages.
- `learning`, `intelligence-langgraph`, `intelligence-mastra`: other independent packages.

A 0.x scope can break in any minor release, as in standard semver.

## When breaking changes ship

The `monorepo` scope is at 1.x. A breaking change can ship in a 1.x minor release. A patch release must not contain a breaking change.

Every breaking change must:

1. Be marked in the pull request, as described below.
2. Include migration steps: what to change, and what to change it to.
3. Update the documentation for the changed API in `showcase/shell-docs/src/content/`.

## How to mark a breaking change

Mark the pull request in one or both of these ways:

- Add `!` after the type in the pull request title, for example `feat(react-core)!: rename oldHook to newHook`.
- Add a `BREAKING CHANGE:` line to the pull request description. Put the migration steps on the lines directly after it, with no blank line between. A blank line ends the note, and so does a line that looks like a trailer, such as `Note: ...`. The release tooling drops any text after that point.

```
BREAKING CHANGE: oldHook is removed.
Call newHook instead. It takes the same arguments.
```

The pull request title becomes the merge commit subject, and the description becomes the merge commit body. The release tooling reads both. A `BREAKING CHANGE:` line in a commit on the pull request branch also counts.

## Where breaking changes appear

The release tooling first writes draft release notes. In the draft, a "Breaking Changes" section lists every marked pull request and the text after its `BREAKING CHANGE:` line. An unmarked breaking change is not in that section.

An AI model then rewrites the draft into the final notes. If that step fails, the tooling uses the draft as is. The final notes go into the `CHANGELOG.md` entry in the release pull request. After that pull request merges, the GitHub release uses the same text. The model can reword, regroup, or leave out entries, so review the Breaking Changes section in the release pull request.

## Deprecations

If a replacement exists, deprecate the API before you remove it:

1. Add a `@deprecated` JSDoc tag that names the replacement.
2. Keep the deprecated API working for at least one minor release.
3. Remove it in a later minor release, and mark that pull request as breaking.

The v1 SDK is deprecated as of 1.68.2. It still ships and still gets bug fixes. New features go into v2.

## Codemods

CopilotKit does not ship codemods. Migration steps are in the release notes and in the documentation.
