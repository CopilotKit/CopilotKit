---
name: copilotkit
description: "Use for any CopilotKit question — adding it to an app, chat UI, frontend or server tools, generative UI, shared state, human-in-the-loop, agent frameworks (LangGraph, CrewAI, Mastra, ADK, PydanticAI, and others), the runtime, Intelligence, threads, voice, or diagnosing something that is not working. Do not answer from memory: this skill exists to point you at the current documentation and source, both of which are searchable."
version: 3.0.0
---

# CopilotKit

CopilotKit's APIs move. Anything written down in a skill file is a copy that starts drifting
the day it is written, so this skill carries almost no API detail on purpose. It tells you
where the current answer lives and how to get it.

**Look it up before you write code.** Not because the docs are more convenient, but because
they are regenerated from the source and a recollection is not.

## The search tools

An MCP server, `copilotkit-docs`, is bundled with this plugin. It exposes four search tools
and two exploration tools over four separate corpora. Picking the wrong one is the most
common way to come up empty:

| Tool                            | Corpus                    | Use it for                                                                                            |
| ------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `search-docs`                   | docs.copilotkit.ai        | Usage, configuration, guides, quickstarts, the generated API reference                                |
| `search-code`                   | CopilotKit library source | How something is implemented, and exact signatures. Library packages only — not examples or showcases |
| `search-ag-ui-docs`             | AG-UI protocol docs       | The protocol itself: event types, transports, the SDKs                                                |
| `search-ag-ui-code`             | AG-UI protocol SDK source | Protocol implementation detail                                                                        |
| `explore-docs` / `explore-code` | either tree               | Browsing structure when you do not yet know what to search for                                        |

CopilotKit questions go to the first two. AG-UI protocol questions go to the second two —
they are a different repository, and `search-docs` will not find them.

**These are semantic searches.** Several short, differently-phrased queries beat one long
one. If a query returns something off-target, rephrase rather than widen — and if you get a
plausible-looking page that does not actually contain the term you need, say so instead of
reasoning from the title.

## Setup

**Claude Code** — configured by this plugin's `.mcp.json`. Nothing to do.

**Codex** — add to `.codex/config.toml`:

```toml
[mcp_servers.copilotkit-docs]
type = "http"
url = "https://mcp.copilotkit.ai/mcp"
```

**Anything else** — the endpoint is `https://mcp.copilotkit.ai/mcp`, streamable HTTP.

Without the MCP server, [the documentation](https://docs.copilotkit.ai) works as a plain
site, and appending `.md` to any docs URL returns that page as Markdown.

## Where the answers are

Worth knowing so a search has somewhere to land:

- **Getting started** — [quickstart](/quickstart), and [the CLI](/cli) for the
  CLI-driven path
- **Frontend** — [frontend tools](/frontend-tools), [human-in-the-loop](/human-in-the-loop),
  [prebuilt components](/prebuilt-components), [styling](/custom-look-and-feel/css),
  [attachments](/multimodal-attachments), [voice](/voice)
- **Runtime** — [the runtime](/backend/copilot-runtime),
  [HTTP endpoints](/backend/runtime-endpoints), [runners](/backend/agent-runner),
  [factory mode](/backend/custom-agent), [server adapters](/runtime-server-adapter),
  [auth](/auth)
- **Agent frameworks** — one quickstart per framework under `/integrations/`
- **Intelligence** — [overview](/intelligence/overview) and the pages under it
- **Not working** — [common issues](/troubleshooting/common-issues),
  [error reference](/troubleshooting/error-reference), and the generated
  [`CopilotKitCoreErrorCode`](/reference/core/enums/CopilotKitCoreErrorCode) for a code the
  app actually reported
- **Protocol** — [AG-UI](/backend/ag-ui), and the AG-UI docs for the protocol itself

## Before you debug anything

Run the CLI's wiring check first. It proves eleven things in one command and it is almost
always faster than reading the project. See the `copilotkit-cli` skill.

## Two versions exist

v2 is current. Import from the `/v2` subpath — `@copilotkit/react-core/v2`,
`@copilotkit/runtime/v2` — and treat a package-root import as the deprecated v1 surface: it
resolves, so the mismatch shows up as routes that 404 rather than as an import error. v1 is
deprecated but supported; [the migration guide](/migrate/v2) covers moving off it.
