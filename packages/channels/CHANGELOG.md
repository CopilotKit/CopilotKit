# Changelog — channels lane

Every `@copilotkit/channels*` package listed under `scopes.channels` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

Entries begin with the first release cut after this file was added. The lane had
no changelog before that.

## 0.9.3 - 2026-09-14

This release trims unused dependencies from the channels packages and fixes Telegram code-fence formatting, alongside internal release-tooling improvements. All channels packages are published at version 0.9.3.

## Fixes

- **Removed the `zod` runtime dependency from `@copilotkit/channels-slack` and `@copilotkit/channels-teams`** (#7081). `channels-teams` declared `zod` (and `zod-to-json-schema`) without importing either, and `channels-slack` used `zod` for a single tool parameter schema. The `lookup_slack_user` schema is now written directly against the [Standard Schema](https://standardschema.dev) protocol — which is all `defineChannelTool` ever required — and emits a byte-for-byte identical JSON Schema, so the tool descriptor the model sees is unchanged, including its strip-unknown-keys behavior. Because `channels-intelligence` is an unconditional dependency of the runtime, these unused declarations previously pulled a `zod` range into every runtime install; removing them eliminates the nested duplicate copies those packages caused.

- **Fixed Telegram code-fence rendering for tagged code blocks** (#6622). Fenced blocks with a language tag (e.g. ` ```js `) now emit Telegram's `<pre><code class="language-js">` form instead of leaking the language token into the code body. Untagged fences remain plain `<pre>`, and single-line ` ```code``` ` fences become inline `<code>`. The language token is validated against a strict pattern (keeping `c++`, `objective-c`, and `asp.net` working) and falls back to a plain `<pre>` when it doesn't match.

## Internal

- **Release notes now ship correctly with GitHub Releases** (#6830). GitHub Release bodies are now generated from a source-controlled, per-lane changelog rather than a scratch file that never reached the release branch, so channels releases carry real notes instead of a bare `Release <tag>` fallback.
