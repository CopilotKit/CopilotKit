---
name: copilotkit-cli
description: "Use for the CopilotKit CLI — `npx copilotkit@latest`. Covers proving a project's wiring with `verify` before debugging anything by hand, scaffolding with `create`, signing in and selecting a hosted Intelligence project, agent-assisted onboarding of an existing app, generating type-safe agent ids, and importing thread history. Reach for `verify` first whenever a CopilotKit app is not working."
version: 1.0.0
---

# CopilotKit CLI

```bash
npx copilotkit@latest <command>
```

`--help` on any command prints its flags. The commands below are the ones worth knowing
before you start reading someone's project by hand.

## `verify` — do this before debugging

```bash
npx copilotkit@latest verify --json
```

One command replaces the manual survey. It settles up to eleven things: a hosted project is
selected; the project API key is present, loadable by the app, and authenticates; the runtime
responds, declares an agent, actually consumes the credential, and serves the thread routes;
the frontend serves its own assets; the runtime accepts the browser's origin; and the
installed CopilotKit packages match the version the runtime reports. It also reports the
runtime version, the agent framework in use, whether transcription is wired, the realtime
gateway wiring, and the license state.

Eleven is the ceiling, not a promise. The last three are omitted when there was nothing to
check them against — no frontend origin was found, or no installed packages were. Count
`checks[]` rather than assuming a fixed set. With `--expect-runtime oss` the hosted-project
and credential checks do not apply at all, so that run is a smaller set.

Crucially it names **which URL it probed and where that URL came from** — the project's
`runtimeUrl`, an environment variable, the app's own dev configuration, or an assumed
default. A survey done by hand cannot tell you that, and the provenance changes the verdict:
nothing answering at a URL **the project named** is a FAIL, while nothing answering at an
**assumed** default is UNKNOWN, because an app on a port the command never learned is not a
wiring failure.

Useful flags:

- `--frontend-url <origin you actually open>` — adds the browser-facing checks, including a
  real CORS preflight when that origin differs from the runtime's
- `--round-trip` — also runs the agent and reads its answer back. Costs a model call, so it
  is opt-in
- `--expect-runtime oss` — for a self-hosted runtime with no Intelligence. It exits zero
  only when `/info` declares the named agent, reports no Intelligence entitlement, and
  `--round-trip --agent <id>` passes
- `--agent <id>` — which declared agent to run, when several are registered
- `--runtime-url <url>` — probe this endpoint instead of the one read from the project
- `--header '<name>: <value>'` — repeatable. Needed when the project's `identifyUser` reads
  a session the CLI does not carry
- `--timeout <seconds>` — how long to wait for an answer, default 90

Read `checks[]` and fix in the order given:

- The checks **chain**. A later check that could not run says so and names the earlier one to
  fix first, so the first failure is the real one.
- `UNKNOWN` means the check could not run. It never means the check passed, and the command
  exits non-zero unless every check passed.

### What `verify` does not cover

Reach past it only once it is clean.

- **Tool execution.** `--round-trip` deliberately asks a question that needs no tools and
  sends no context, so a passing round trip says nothing about whether your tools work.
- **Event ordering and streaming.** It reports pass or fail on a run, not the sequence inside
  it. A run that starts and never finishes, or stalls mid-stream, is a job for the Inspector.
- **State synchronisation.** Snapshot-versus-delta divergence is agent behaviour, not wiring.

## Starting a project

```bash
npx copilotkit@latest init          # `create` is an alias for it
```

Prompts for a name and framework, scaffolds a starter, signs you in when needed, and connects
the app to a cloud-hosted Intelligence project. The name it asks for names the new directory,
so this is the path for a project that does not exist yet. For an app you already have, use
`onboard start` below.

To add CopilotKit to an existing app, either follow the [quickstart](/quickstart), or hand
the job to your coding agent:

```bash
npx copilotkit@latest onboard start
```

That runs an agent-guided flow over the repository you are already in, with checkpoints and
proof steps rather than a scaffold. `onboard start --intent <feature>` targets one feature on
an app that already has CopilotKit.

## Signing in and picking a project

```bash
npx copilotkit@latest login --json   # agent-readable JSON lines, no browser launch
npx copilotkit@latest login          # interactive: opens a browser
npx copilotkit@latest whoami         # who is signed in, and the active organization
npx copilotkit@latest project select # pick or create a hosted project for this directory
npx copilotkit@latest project list --json
```

Use `login --json` when you are driving the CLI. Bare `login` tries to open a browser, which
is not something you can complete.

There is no `auth` command. It is `login`.

`project select` records the choice in `.copilotkit/project.json` and provisions a
project-scoped runtime key into `.env`:

```
CPK_INTELLIGENCE_API_KEY=cpk_...
```

`CPK_INTELLIGENCE_API_KEY` is the canonical name and the only one the CLI writes. Keep it
server-side — it is a runtime key, not a frontend token, so it takes **no** `NEXT_PUBLIC_` or
`VITE_` prefix. Do not set the platform URLs: they default to the managed hosts, so any value
you supply can only replace a correct default with a worse one.

Without a TTY — which is what a coding agent has — use `project list --json` to see the
choices and `project select --project <id>` or `--create <name>` to name the answer up front.

## Other commands

| Command                                    | What it does                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `skills install`                           | Installs these skills into a project (`skills onboard` also starts onboarding) |
| `typegen`                                  | Generates type-safe agent ids from a running runtime                           |
| `import --source adk\|langgraph --dry-run` | Previews importing historical threads into Intelligence                        |
| `license create` / `license list`          | Issues and lists license tokens                                                |
| `channels`                                 | Sets up managed Intelligence Channels for Slack or Microsoft Teams             |
| `framework list`                           | The agent frameworks `create` accepts, and their flags                         |
| `logs`                                     | The CLI log path, or recent lines                                              |
| `telemetry`                                | Shows or changes the CLI telemetry preference                                  |
| `docs`                                     | Opens the documentation                                                        |
| `version`                                  | Version, build, and commit                                                     |

The CLI collects usage data. `DO_NOT_TRACK=1` or `COPILOTKIT_TELEMETRY_DISABLED=1` opts out.
