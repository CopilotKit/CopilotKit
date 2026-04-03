# Security

## Trust Model

This plugin runs inside your AI coding agent (Claude Code, Codex, Cursor, etc.) with the same permissions as the agent itself. By installing it, you trust:

1. **CopilotKit/skills repository** — The SKILL.md files and reference docs are loaded into the agent's context and influence its behavior. We maintain this repo and review all changes.

2. **MCP server at mcp.copilotkit.ai** — Skills can query this server for live documentation via `search-docs` and `search-code` tools. We host and control this server. It indexes the CopilotKit and AG-UI public repositories.

3. **Auto-approval hooks** — The plugin includes a PreToolUse hook (`hooks/auto-approve-copilotkit.sh`) that auto-approves specific read-only shell commands without user confirmation:
   - `npx copilotkit --help/--version/info/doctor`
   - `pnpm list @copilotkit/*` / `npm ls @copilotkit/*`
   - `nx run @copilotkit/*:test` / `vitest run` (test execution)
   - `nx run @copilotkit/*:build` (build verification)

   The hook **never** auto-approves: `install`, `add`, `remove`, `delete`, `publish`, `deploy`, `push`, or any other destructive operation. Unrecognized commands are deferred to the user for manual approval.

## What This Plugin Cannot Do

- It cannot execute code outside of what the agent already has permission to do
- It cannot access files or networks beyond the agent's sandbox
- It cannot auto-approve destructive operations
- The hooks only fire for Bash commands matching specific patterns

## Reporting Vulnerabilities

If you find a security issue, please report it to security@copilotkit.ai or open a GitHub issue at https://github.com/CopilotKit/skills/issues.
