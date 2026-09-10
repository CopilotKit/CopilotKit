---
name: copilotkit-debug
description: "Use when diagnosing CopilotKit issues -- the runtime is unreachable, an agent does not respond or stream, tools do not execute, voice transcription fails, saved threads do not load, or the browser refuses the runtime's responses."
version: 2.0.0
---

# Debugging CopilotKit

## Start with `copilotkit verify`

Do not survey the project by hand. One command proves or disproves most of the wiring, and
reports which URL it probed and where that URL came from:

```bash
npx copilotkit@latest verify --json
```

Add `--frontend-url <the origin you actually open>` to include the browser-facing checks, and
`--round-trip` to also run the agent and read its answer back. Use `--expect-runtime oss` for
a self-hosted runtime with no Intelligence.

It reports eleven checks: whether a hosted project is selected, whether the project API key is
present, loadable by the app, and authenticates; whether the runtime responds, declares an
agent, actually consumes the credential, and serves the thread routes; whether the frontend
serves its own assets; whether the runtime accepts the browser's origin; and whether the
installed CopilotKit packages match the version the runtime reports. It also reports the
runtime version, the agent framework in use, whether transcription is wired, the realtime
gateway wiring, and the license state.

Read `checks[]` and fix in the order given. Two properties make that order worth trusting:

- The checks **chain**. A later check that could not run says so and names the earlier one to
  fix first, so the first failure is the real one.
- `UNKNOWN` means the check could not run. It never means the check passed, and the command
  exits non-zero unless every check passed.

## What `verify` cannot see

Three classes of fault are outside it. Reach for these only after `verify` is clean.

**Tool execution.** The round trip deliberately asks a question that needs no tools and sends
no context, so a passing round trip says nothing about whether your tools work. Debug these
against the tool's own layer: a frontend tool's handler, a server tool's `execute`.

**Event ordering and streaming.** `verify` reports pass or fail on a run, not the event
sequence inside it. A run that starts and never finishes, arrives out of order, or stalls
mid-stream is an Inspector problem: see
[Event Inspector](https://docs.copilotkit.ai/troubleshooting/event-inspector) and
[debug mode](https://docs.copilotkit.ai/troubleshooting/debug-mode).

**State synchronisation.** Snapshot-versus-delta divergence between agent and app is agent
behaviour, not wiring. Watch it in the Inspector.

## Error codes

Do not work from a memorised catalog — the codes are generated from source and change with it.
Look up the code the app actually reported:

- [`CopilotKitCoreErrorCode`](https://docs.copilotkit.ai/reference/core/enums/CopilotKitCoreErrorCode)
  — the codes surfaced through the `onError` subscriber
- [Error reference](https://docs.copilotkit.ai/troubleshooting/error-reference) — the common
  failures with causes and fixes
- [Common issues](https://docs.copilotkit.ai/troubleshooting/common-issues)

## Known bugs

Search the tracker rather than a cached list; a list of "known issues" in a skill goes stale
the moment one is fixed, and reads as current until someone checks:

```
https://github.com/CopilotKit/CopilotKit/issues?q=is%3Aissue+<symptom>
```

Include the version from `verify`'s report in the search, and in any issue you file.

## Live documentation (MCP)

The plugin ships an MCP server, `copilotkit-docs`, exposing `search-docs` and `search-code`
against current documentation and source.

- **Claude Code** — configured by the plugin's `.mcp.json`. Nothing to do.
- **Codex** — add to `.codex/config.toml`:

  ```toml
  [mcp_servers.copilotkit-docs]
  type = "http"
  url = "https://mcp.copilotkit.ai/mcp"
  ```

Search it for the error code, the hook, or the option you are looking at, rather than
recalling an API shape.
