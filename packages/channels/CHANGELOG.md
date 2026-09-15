# Changelog — channels lane

Every `@copilotkit/channels*` package listed under `scopes.channels` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

Entries begin with the first release cut after this file was added. The lane had
no changelog before that.

## 0.10.0 - 2026-09-15

This release trims the dependency footprint of the Teams and Slack channel packages and fixes Telegram code-block formatting. The headline change is a breaking one for self-hosted Teams users: the Microsoft Agents SDK and Express are now optional peer dependencies.

## Breaking Changes

### Self-hosted Teams now requires installing the Microsoft Agents SDK (#7084)

`@microsoft/agents-hosting`, `@microsoft/agents-activity`, and `express` are now **optional peer dependencies** of `@copilotkit/channels-teams` (and of `@copilotkit/channels`, whose `./teams` subpath re-exports the adapter). Previously these were bundled as hard dependencies, which pulled the entire Microsoft Agents stack — and its pinned `zod` version — into every install that transitively depended on the Teams package, including plain runtime installs that never used Teams.

These SDKs are only reached from the self-hosted surface (the Teams adapter and listener). Managed Channels reach the package solely through `@copilotkit/channels-teams/render`, whose module graph touches none of them, so **managed users are unaffected**.

Because optional peers are not auto-installed, this is silent at install time and surfaces at import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@microsoft/agents-hosting'
```

**Migration** — if you self-host Teams, add the Microsoft packages:

```sh
npm install @microsoft/agents-hosting @microsoft/agents-activity
```

`express` is also an optional peer, but it is now loaded lazily inside `createTeamsServer().start()`, so you only need it if you use the built-in listener. Bots that serve `POST /api/messages` from their own HTTP server never need to install it. Both package READMEs carry the install line and the reasoning.

## Fixes

- **Teams:** `express` is now imported lazily inside `createTeamsServer().start()` instead of at module scope. Importing `@copilotkit/channels-teams` no longer requires `express`, and calling `start()` without it produces a clear, actionable error naming the missing package rather than a raw module-not-found. Verified serving on both Express 4 and 5. (#7084)

- **Slack & Teams:** Removed unused `zod` and `zod-to-json-schema` runtime dependencies from `@copilotkit/channels-slack` and `@copilotkit/channels-teams`. Neither Teams file imported them, and Slack used `zod` for a single tool schema, now written directly against the [Standard Schema](https://standardschema.dev) protocol. The JSON Schema shown to the model is unchanged. (#7081)

- **Slack:** The `lookup_slack_user` tool now reports the actual received type for invalid arguments. Previously `null` and arrays both reported `received object` because `typeof` reports `"object"` for both; validation now matches Zod's naming (`null`, `array`, `string`, `number`). Validation behavior is unchanged — only the message the agent reads back is corrected. (#7081)

- **Telegram:** Tagged fenced code blocks (e.g. ` ```js `) now emit Telegram's `<pre><code class="language-js">` form instead of leaking the language token into the code body. Untagged fences stay plain `<pre>`, and single-line fences become inline `<code>`. Only valid language tokens become class names; anything else falls back to plain `<pre>`. (#6622)

## Other

- **Release tooling:** Fixed GitHub Release notes so the generated changelog section actually ships as the release body, instead of falling back to a bare `Release <tag>`. Release notes are now kept in a source-controlled, per-lane changelog. (#6830)

## 0.9.3 - 2026-09-14

This release trims unused dependencies from the channels packages and fixes Telegram code-fence formatting, alongside internal release-tooling improvements. All channels packages are published at version 0.9.3.

## Fixes

- **Removed the `zod` runtime dependency from `@copilotkit/channels-slack` and `@copilotkit/channels-teams`** (#7081). `channels-teams` declared `zod` (and `zod-to-json-schema`) without importing either, and `channels-slack` used `zod` for a single tool parameter schema. The `lookup_slack_user` schema is now written directly against the [Standard Schema](https://standardschema.dev) protocol — which is all `defineChannelTool` ever required — and emits a byte-for-byte identical JSON Schema, so the tool descriptor the model sees is unchanged, including its strip-unknown-keys behavior. Because `channels-intelligence` is an unconditional dependency of the runtime, these unused declarations previously pulled a `zod` range into every runtime install; removing them eliminates the nested duplicate copies those packages caused.

- **Fixed Telegram code-fence rendering for tagged code blocks** (#6622). Fenced blocks with a language tag (e.g. ` ```js `) now emit Telegram's `<pre><code class="language-js">` form instead of leaking the language token into the code body. Untagged fences remain plain `<pre>`, and single-line ` ```code``` ` fences become inline `<code>`. The language token is validated against a strict pattern (keeping `c++`, `objective-c`, and `asp.net` working) and falls back to a plain `<pre>` when it doesn't match.

## Internal

- **Release notes now ship correctly with GitHub Releases** (#6830). GitHub Release bodies are now generated from a source-controlled, per-lane changelog rather than a scratch file that never reached the release branch, so channels releases carry real notes instead of a bare `Release <tag>` fallback.
