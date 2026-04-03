# CopilotKit Skills for AI Agents

[![Agent Skills Standard](https://img.shields.io/badge/Agent%20Skills-agentskills.io-blue)](https://agentskills.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![CopilotKit v2](https://img.shields.io/badge/CopilotKit-v2-purple)](https://docs.copilotkit.ai)

Skills, hooks, MCP configuration, and reference docs that teach AI coding agents how to build with CopilotKit. Covers project setup, feature development, integration wiring, debugging, version migration, and open-source contribution -- all targeting the v2 API surface (`@copilotkit/*`).

Built on the open [Agent Skills](https://agentskills.io) standard. One set of SKILL.md files works across Claude Code, Codex, Cursor, and OpenCode.

## Table of Contents

- [Why This Exists](#why-this-exists)
- [Compatibility](#compatibility)
- [Installation](#installation)
- [Skills](#skills)
  - [copilotkit-setup](#copilotkit-setup)
  - [copilotkit-develop](#copilotkit-develop)
  - [copilotkit-integrations](#copilotkit-integrations)
  - [copilotkit-debug](#copilotkit-debug)
  - [copilotkit-upgrade](#copilotkit-upgrade)
  - [copilotkit-contribute](#copilotkit-contribute)
- [Architecture](#architecture)
  - [MCP Integration](#mcp-integration)
  - [AG-UI Protocol](#ag-ui-protocol)
  - [v2 API Surface](#v2-api-surface)
- [Auto-Approval Hooks](#auto-approval-hooks)
- [Automation Pipeline](#automation-pipeline)
- [Repository Structure](#repository-structure)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)

---

## Why This Exists

CopilotKit has a rich API surface spanning React hooks, runtime configuration, agent frameworks, and a streaming protocol. An AI coding agent asked to "add CopilotKit to my app" needs to know which packages to install, which hooks to use, how to wire up the runtime, and how to connect an agent framework -- and it needs to get the v2 APIs right, not the deprecated v1 equivalents.

These skills encode that knowledge. Instead of relying on the agent's training data (which may be stale or incomplete), the skills provide authoritative, maintained guidance that stays current with CopilotKit releases.

---

## Compatibility

| Feature | Claude Code | Codex | OpenCode | Cursor |
|---------|-------------|-------|----------|--------|
| Skill prompts (SKILL.md) | Yes | Yes | Yes | Yes |
| MCP docs integration | Yes | Yes | Yes | Yes |
| Auto-approval hooks | Yes | -- | -- | -- |
| Codex agent config | -- | Yes | -- | -- |

---

## Installation

### Recommended: npx skills (all tools)

Works across Claude Code, Codex, Cursor, Gemini CLI, and all tools supporting the [agentskills.io](https://agentskills.io) standard:

```bash
npx skills add copilotkit/skills --full-depth -y
```

Fresh clones from GitHub every time. To **update**, run the same command again — it always gets the latest.

### Alternative: Claude Code plugin marketplace

```bash
/plugin marketplace add CopilotKit/skills
/plugin install copilotkit
/reload-plugins
```

Note: Claude Code's marketplace update mechanism has [known issues](https://github.com/anthropics/claude-code/issues/26744) with third-party plugins. If updates aren't being picked up, use `npx skills add copilotkit/skills --full-depth -y` instead.

### Alternative: Manual install

Copy skills into `~/.codex/skills/`:

```bash
git clone https://github.com/CopilotKit/skills.git /tmp/copilotkit-skills
cp -R /tmp/copilotkit-skills/skills/copilotkit-* ~/.codex/skills/
```

### Manual Installation (Any Tool)

Copy each skill directory from `skills/` into your tool's skills directory:

| Tool | Skills directory |
|------|-----------------|
| Claude Code | `~/.claude/skills/<skill-name>/` |
| Codex | `~/.codex/skills/<skill-name>/` |
| OpenCode | `~/.config/opencode/skills/<skill-name>/` |
| Cursor | `~/.cursor/skills/<skill-name>/` |

---

## Skills

### copilotkit-setup

Add CopilotKit to a project from scratch.

- Detects your framework: Next.js App Router, Next.js Pages Router, Remix, or Vite
- Installs `@copilotkit/*` packages
- Wires up the v2 `CopilotRuntime` with your LLM provider (OpenAI, Anthropic, Google, etc.)
- Configures the `CopilotKitProvider` and verifies the integration works end-to-end

[Full Documentation](skills/copilotkit-setup/SKILL.md)

### copilotkit-develop

Build AI-powered features using CopilotKit's v2 APIs.

- `useAgent` -- connect a backend agent to the frontend
- `useFrontendTool` -- expose UI actions as tools the agent can call
- `useComponent` -- render agent-driven React components
- `CopilotChat` -- drop-in chat interface with message views and input handling
- `useInterrupt`, `useHumanInTheLoop`, `useSuggestions` -- control flow and UX primitives
- `AgentRunner` and `BuiltInAgent` -- runtime agent orchestration

[Full Documentation](skills/copilotkit-develop/SKILL.md)

### copilotkit-integrations

Per-framework integration guides for connecting agent backends to CopilotKit.

Covers 10 agent frameworks and protocols:

| Framework | Type |
|-----------|------|
| LangGraph | Python/JS agent graph |
| CrewAI | Multi-agent crew |
| PydanticAI | Typed Python agent |
| Mastra | TypeScript agent framework |
| Google ADK | Agent Development Kit |
| LlamaIndex | RAG/agent pipeline |
| Agno | Lightweight agent |
| Strands | AWS agent SDK |
| MS Agent Framework | Python/.NET agent |
| A2A/MCP | Agent-to-Agent and Model Context Protocol |

Each guide covers installation, runtime wiring, and a working example.

[Full Documentation](skills/copilotkit-integrations/SKILL.md)

### copilotkit-debug

Diagnose and fix CopilotKit issues.

- Error catalog seeded from real GitHub issues and common failure modes
- Structured diagnostic sequences: runtime connection, SSE streaming, hook binding, provider auth
- Escalation path: self-service diagnostics, then GitHub issue, then Discord

[Full Documentation](skills/copilotkit-debug/SKILL.md)

### copilotkit-upgrade

Migrate between CopilotKit versions.

- Version-to-version migration guides
- Breaking changes catalog with before/after code
- Deprecation mapping: v1 (`@copilotkit/*`) to v2 (`@copilotkit/*`) equivalents
- Automated detection of deprecated API usage in your codebase

[Full Documentation](skills/copilotkit-upgrade/SKILL.md)

### copilotkit-agui

AG-UI protocol reference for building custom agent backends and understanding agent-to-UI communication.

- Complete event type reference (~30 event types with schemas and examples)
- Building AG-UI compliant backends from scratch
- Event flow diagrams for common scenarios (chat, tool calls, state sync, human-in-the-loop)
- @ag-ui/client SDK API reference (AbstractAgent, HttpAgent, middleware)
- Transport encoding (SSE and protobuf)

[Full Documentation](skills/copilotkit-agui/SKILL.md)

### copilotkit-contribute

Contribute to CopilotKit open source.

- Repository structure and Nx workspace layout
- Package architecture: runtime, React SDK, shared types, protocol
- Testing: running tests, writing tests, coverage expectations
- PR guidelines: branch naming, commit conventions, review process
- Local development: linking packages, running the demo app

[Full Documentation](skills/copilotkit-contribute/SKILL.md)

---

## Architecture

### MCP Integration

The plugin includes an MCP (Model Context Protocol) server (`copilotkit-docs`) that gives agents programmatic access to CopilotKit documentation via `search-docs` and `search-code` tools. Agents can query for specific API signatures, search for usage examples, and look up configuration options without relying on training data alone.

**Claude Code:** The MCP server is configured in `.mcp.json` at the repository root and is automatically available when the plugin is installed. No manual setup needed.

**Codex:** Add the following to your `.codex/config.toml`:

```toml
[mcp_servers.copilotkit-docs]
type = "http"
url = "https://mcp.copilotkit.ai/mcp"
```

**Other tools:** Configure your tool to connect to `https://mcp.copilotkit.ai/mcp` as an HTTP MCP server.

### AG-UI Protocol

CopilotKit's v2 runtime communicates with frontends via the AG-UI protocol -- an SSE (Server-Sent Events) based event streaming format. Agents emit typed events (text deltas, tool calls, state updates, component renders) that the React SDK consumes in real-time.

Understanding AG-UI is important when:
- Debugging streaming issues between the runtime and frontend
- Building custom agent runners that need to emit protocol-compliant events
- Integrating agent frameworks that don't have a built-in CopilotKit adapter

The `copilotkit-develop` and `copilotkit-debug` skills include AG-UI protocol details where relevant.

### v2 API Surface

All skills target the v2 API exclusively. The key packages and their roles:

| Package | Role |
|---------|------|
| `@copilotkit/react` | React hooks and components (`useAgent`, `CopilotChat`, etc.) |
| `@copilotkit/runtime` | Server-side runtime (`CopilotRuntime`, `AgentRunner`) |
| `@copilotkit/shared` | Shared types and protocol definitions |
All packages are installed under `@copilotkit/*`. The v2 API is exposed through the same namespace — no package name changes are needed. The `copilotkit-upgrade` skill covers API-level migration (hook renames, component changes, runtime config).

---

## Auto-Approval Hooks

Hooks auto-approve safe, read-only operations so agents can work without constant permission prompts.

**Auto-approved (read-only):**

- `npx copilotkit` -- CopilotKit CLI operations
- `pnpm list` / `npm list` -- dependency inspection

**Auto-approved (contributor scope only):**

- `nx test <package>` -- running tests
- `nx build <package>` -- building packages

Operations that modify project files, install packages, or make network requests still require explicit approval.

Hook configuration lives in `hooks/hooks.json` with the approval logic in `hooks/auto-approve-copilotkit.sh`.

---

## Automation Pipeline

Skills are maintained through a two-stage pipeline:

### Bootstrap Generation

Reference material in each skill's `references/` directory is auto-generated from the CopilotKit codebase. This includes API signatures, type definitions, configuration schemas, and integration examples extracted directly from source.

### Daily Maintenance

A daily pipeline (6am UTC) refreshes reference material to stay current with CopilotKit development:

1. Pulls the latest CopilotKit source
2. Regenerates `references/` content for each skill
3. Detects new integration frameworks and generates guides via Claude API (Strategy 2)
4. Runs validation to catch breaking changes or new APIs
5. If changes detected: pushes to a single `auto/update-skills` branch and opens or updates a PR

Daily runs batch into a single open PR — no spam. Each run adds commits to the same branch until someone merges. If no CopilotKit source changes occurred, no PR is created or updated.

SKILL.md files are human-maintained. They are written once during bootstrap and updated manually when the skill's guidance needs to change. The separation between generated references and authored guidance keeps maintenance tractable while ensuring API details stay accurate.

Each skill includes a `sources.md` listing which CopilotKit source files were read to generate its references, enabling staleness detection.

---

## Skill Evals

Skills include [skillgrade](https://github.com/mgechev/skill-eval) eval configs (`eval.yaml`) that validate skills work correctly by testing them against real agent scenarios.

```bash
npm i -g skillgrade

# Run smoke tests on the setup skill
cd skills/copilotkit-setup
ANTHROPIC_API_KEY=your-key skillgrade --smoke

# Run on the develop skill
cd skills/copilotkit-develop
ANTHROPIC_API_KEY=your-key skillgrade --smoke
```

Evals spin up an agent in Docker, give it the skill plus a task, and grade the output with deterministic checks and LLM rubrics.

---

## Repository Structure

```
CopilotKit/skills/
├── .claude-plugin/
│   ├── plugin.json               # Plugin manifest for Claude Code
│   └── marketplace.json          # Marketplace metadata
├── agents/
│   └── openai.yaml               # Codex agent configuration
├── .mcp.json                     # MCP server configuration (mcp-docs)
├── hooks/
│   ├── hooks.json                # Hook definitions
│   └── auto-approve-copilotkit.sh  # Auto-approval logic
├── skills/
│   ├── copilotkit-setup/         # Project setup and framework detection
│   ├── copilotkit-develop/       # Feature development with v2 APIs
│   ├── copilotkit-integrations/  # Agent framework integration guides
│   ├── copilotkit-debug/         # Error catalog and diagnostics
│   ├── copilotkit-agui/           # AG-UI protocol reference
│   ├── copilotkit-upgrade/       # Version migration and deprecation mapping
│   └── copilotkit-contribute/    # OSS contribution guide
├── scripts/
│   ├── install.sh                # Multi-tool installer
│   ├── mcp-query.sh              # MCP JSON-RPC helper for CI
│   └── detect-new-integrations.sh # Integration guide gap detection
├── SKILL.md                      # Root router for npx skills add
├── CLAUDE.md                     # Claude Code project instructions
├── AGENTS.md                     # Codex agent instructions
├── README.md                     # This file
└── LICENSE
```

---

## Contributing

### Adding a New Skill

1. Create `skills/your-skill-name/` with a `SKILL.md` file and optional `references/` directory.

2. Add frontmatter to `SKILL.md`:

   ```yaml
   ---
   name: your-skill-name
   description: Brief description of what the skill does
   license: MIT
   compatibility: Requirements and prerequisites
   metadata:
     author: CopilotKit
     version: "1.0.0"
     category: copilotkit
   ---
   ```

3. Write the skill content. Keep `SKILL.md` focused on actionable guidance -- what the agent should do, in what order, with what commands. Move API details and reference material to `references/`.

4. Test locally:

   ```bash
   # Claude Code
   claude plugin add /path/to/skills

   # Manual
   cp -R skills/your-skill-name ~/.claude/skills/your-skill-name
   ```

5. Open a PR. Include a description of what the skill covers and why it's useful.

### Updating Existing Skills

- **SKILL.md changes**: Edit directly. These are human-maintained.
- **Reference updates**: Run the bootstrap pipeline or edit `references/` files. These will be overwritten on the next pipeline run unless the pipeline is updated to preserve your changes.

### Versioning

Claude Code plugin updates are version-string based. The cache is keyed by version — commits without a version bump are invisible to users.

1. Bump the version in `.claude-plugin/plugin.json` with every meaningful push
2. A GitHub Actions workflow automatically syncs the version to `marketplace.json`
3. Users on `npx skills add` just re-run the command to get the latest
4. Users on Claude Code marketplace *should* get updates on session start, but this has [known issues](https://github.com/anthropics/claude-code/issues/26744) — recommend `npx skills add` for reliable updates

---

## Support

- **CopilotKit Docs:** [docs.copilotkit.ai](https://docs.copilotkit.ai)
- **Discord:** [discord.gg/copilotkit](https://discord.gg/copilotkit)
- **GitHub Issues:** [github.com/CopilotKit/skills/issues](https://github.com/CopilotKit/skills/issues)
- **CopilotKit GitHub:** [github.com/CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit)
- **Agent Skills Standard:** [agentskills.io](https://agentskills.io)

---

## License

MIT License -- see [LICENSE](LICENSE) for details.
