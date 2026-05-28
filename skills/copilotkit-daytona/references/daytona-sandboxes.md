# Daytona Sandboxes — essentials & canonical sources

Daytona sandboxes are isolated cloud Linux runtimes for AI agents. This file keeps only the few facts the
CopilotKit integration relies on; for anything else, prefer Daytona's own maintained sources below (they
stay current as the SDK changes — don't trust a hand-copied API surface).

## Canonical sources (prefer these — kept current by Daytona)

- **AI-readable docs index:** https://www.daytona.io/llms.txt — indexes the TypeScript/Python SDK reference,
  code execution, sandboxes, limits, MCP, and integration guides. Start here for current API details.
- **Limits & tiers (source of truth):** https://app.daytona.io/dashboard/limits — per-org compute pools,
  per-sandbox caps, and rate limits are account/tier-specific and change; read them live, do not hardcode.
- **Network whitelist (continuously updated):** https://github.com/daytonaio/sandbox-network-whitelist
- **Official `daytona` Agent Skill** — if installed, defer to it for sandbox SDK specifics; it is
  Daytona-maintained and versioned.
- **Daytona MCP server** — `daytona mcp init claude` (also `cursor`, `windsurf`) sets up a local MCP server
  (`daytona mcp start`) exposing sandbox management, file ops, git, process/code execution, and preview as
  live tools. Useful for the coding agent to provision and verify sandboxes while wiring up the integration,
  instead of relying on a static reference.

## Minimal API the `runCode` tool uses (stable core)

```ts
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona(); // reads DAYTONA_API_KEY; throws at construction if missing
const sandbox = await daytona.create({ language }); // language: "python" | "typescript" | "javascript" (default "python")
const res = await sandbox.process.codeRun(code); // -> { result (stdout), exitCode }
await sandbox.delete(); // or stop()/start() to reuse
```

- `codeRun` runs in the runtime chosen at creation (Python/TS/JS). For **other languages** (Go, Rust, shell),
  use `sandbox.process.executeCommand(cmd)`, optionally on a custom `Image`.
- Reuse: `stop()` / `start()` instead of `delete()` to avoid per-call startup cost.
- Preview a server the agent starts: `sandbox.getPreviewLink(port)`.

## Network tiers (reconfirmed against Daytona docs — qualitative; numbers live on the dashboard)

- **Tier 1 & Tier 2:** sandbox network access is **restricted and cannot be overridden at the sandbox level**
  — org-level restrictions take precedence even if `networkAllowList` is set.
- **Tier 3 & Tier 4:** full outbound internet by default, with configurable per-sandbox firewall.
- **All tiers:** an _"essential services"_ allowlist is always reachable — package registries (npm, PyPI),
  Git hosts, container registries, CDNs, and major AI APIs (OpenAI, Anthropic, Google). Daytona notes this
  list is _continuously updated_, so check the whitelist repo above rather than relying on a copy here.

Net for this recipe: it works on the free tier because the model APIs and registries are whitelisted; code
that must reach arbitrary external URLs needs Tier 3+.
