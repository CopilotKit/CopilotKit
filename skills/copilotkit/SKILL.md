---
name: copilotkit
description: "Use for any CopilotKit question — adding it to an app, chat UI, frontend or server tools, generative UI, shared state, human-in-the-loop, agent frameworks (LangGraph, CrewAI, Mastra, ADK, PydanticAI, and others), the runtime, Intelligence, threads, voice, or diagnosing something that is not working. Do not answer from memory: this skill exists to point you at the current documentation and source, both of which you can read."
version: 3.1.0
---

# CopilotKit

CopilotKit's APIs move. Anything written down in a skill file is a copy that starts drifting
the day it is written, so this skill carries almost no API detail on purpose. It tells you
where the current answer lives and how to get it.

**Look it up before you write code.** Not because the docs are more convenient, but because
they are regenerated from the source and a recollection is not.

## Reading the docs

There are two ways to read the current docs. Check which one this session has.

### Without the MCP server: fetch the Markdown pages

This path always works. It needs only a way to fetch a URL.

- **Any docs page as Markdown.** Add `.md` to the page path:
  `https://docs.copilotkit.ai/<path>.md`. For example,
  `https://docs.copilotkit.ai/quickstart.md` and
  `https://docs.copilotkit.ai/backend/copilot-runtime.md`. The response is
  `text/markdown`. A path that does not exist returns 404 with the body `Not found`.
- **To find a path.** Start with `https://docs.copilotkit.ai/llms.txt`. It is a short,
  curated index with links to the main pages. For a page it does not list, read
  `https://docs.copilotkit.ai/sitemap.xml`, which lists every page URL. Both indexes list
  HTML page URLs. Add `.md` to a URL before you fetch it. The site root has no `.md` form.
  Do not fetch `llms-full.txt` in one read. It holds every page and is several megabytes.
- **Links in this skill.** A link such as [quickstart](/quickstart) is a docs path.
  Fetch it as `https://docs.copilotkit.ai/quickstart.md`.
- **Library source.** Read the installed package in `node_modules/@copilotkit/`, or the
  source at `https://github.com/CopilotKit/CopilotKit` under `packages/`.
- **AG-UI protocol.** The protocol has its own docs at `https://docs.ag-ui.com`. Its index
  is `https://docs.ag-ui.com/llms.txt`, and its pages also take `.md`.

### With the MCP server: search tools

The CopilotKit Claude Code plugin also declares an MCP server, `copilotkit-docs`, in its
`.mcp.json`. When that server is loaded, it adds search tools over four separate corpora.
It is a faster way to search. It is not required. If these tools are not in this session,
use the Markdown pages above.

| Tool                            | Corpus                    | Use it for                                                                                           |
| ------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `search-docs`                   | docs.copilotkit.ai        | Usage, configuration, guides, quickstarts, the generated API reference                               |
| `search-code`                   | CopilotKit library source | How something is implemented, and exact signatures. Library packages only, not examples or showcases |
| `search-ag-ui-docs`             | AG-UI protocol docs       | The protocol itself: event types, transports, the SDKs                                               |
| `search-ag-ui-code`             | AG-UI protocol SDK source | Protocol implementation detail                                                                       |
| `explore-docs` / `explore-code` | either tree               | Browsing structure when you do not yet know what to search for                                       |

CopilotKit questions go to the first two. AG-UI protocol questions go to the second two.
They are a different repository, and `search-docs` will not find them.

**These are semantic searches.** Several short queries with different words beat one long
query. If a result is off-target, rephrase the query. Do not make it wider. If a page looks
right but does not contain the term you need, say so. Do not reason from the title.

A user who wants the search tools outside the plugin can add the server themselves. The
endpoints are `https://mcp.copilotkit.ai/mcp` (streamable HTTP) and
`https://mcp.copilotkit.ai/sse` (SSE). Keep the path, because the bare host returns 404.
[Build with agents](/build-with-agents) has the steps for each coding tool. Do not add the
server on your own as a setup step. The Markdown pages give the same content.

## Where the answers are

Worth knowing so a search or a fetch has somewhere to land. Each link is a docs path:

- **Getting started** — [quickstart](/quickstart), and [the CLI](/cli) for the
  CLI-driven path
- **Frontend** — [frontend tools](/frontend-tools), [human-in-the-loop](/human-in-the-loop),
  [prebuilt components](/prebuilt-components), [styling](/custom-look-and-feel/css),
  [attachments](/multimodal-attachments), [voice](/voice)
- **Runtime** — [the runtime](/backend/copilot-runtime),
  [HTTP endpoints](/backend/runtime-endpoints), [runners](/backend/agent-runner),
  [factory mode](/backend/custom-agent), [server adapters](/runtime-server-adapter),
  [auth](/auth)
- **Agent frameworks** — one quickstart per framework, at
  `https://docs.copilotkit.ai/<framework>/quickstart.md`. The framework slugs are in
  `llms.txt`, for example `langgraph-python`, `mastra`, and `crewai-crews`.
- **Intelligence** — [overview](/intelligence/overview) and the pages under it
- **Not working** — [common issues](/troubleshooting/common-issues),
  [error reference](/troubleshooting/error-reference), and the generated
  [`CopilotKitCoreErrorCode`](/reference/core/enums/CopilotKitCoreErrorCode) for a code the
  app actually reported
- **Protocol** — [AG-UI](/backend/ag-ui), and the AG-UI docs for the protocol itself

## Before you debug anything

Run the CLI's wiring check first. It settles up to eleven things in one command and is almost
always faster than reading the project. Pick the form that matches the app:

- **No Intelligence** (nothing constructs `CopilotKitIntelligence` where the runtime is built,
  and there is no `.copilotkit/project.json`):
  `npx copilotkit@latest verify --expect-runtime oss --round-trip --agent <id> --json`
- **Otherwise:** `npx copilotkit@latest verify --json`

Do not run `login` or `project select` only to make `verify` pass. Those commands set up
hosted Intelligence and do not fix an open-source app. See the `copilotkit-cli` skill.

## Two versions exist

v2 is current. Import from the `/v2` subpath — `@copilotkit/react-core/v2`,
`@copilotkit/runtime/v2`. The package root is the deprecated v1 surface and still resolves,
so mixing the two raises nothing at import time and surfaces later as a runtime mismatch.
Check which subpath a project imports before trusting anything else about it. v1 is
deprecated but supported; [the migration guide](/migrate/v2) covers moving off it.
