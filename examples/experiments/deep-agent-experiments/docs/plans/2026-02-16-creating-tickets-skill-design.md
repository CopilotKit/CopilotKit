# Design: `reproduce-issue` Skill

## Purpose

A Claude Code skill (also human-readable) that guides creating new ticket reproduction sandboxes. Tickets are convention-discovered across three optional layers: frontend, server, and agent.

## Location

`.claude/skills/reproduce-issue/SKILL.md` — committed to the repo so anyone working on the project gets it.

## Skill Type

Convention reference with decision flowchart.

## Frontmatter

```yaml
name: reproduce-issue
description: Use when creating a new ticket reproduction sandbox — covers file naming, required exports, layer selection (frontend, server, agent), and discovery mechanics. Also use when asked to "add a ticket", "new tkt-*", or "scaffold a reproduction."
```

## Content Sections

### Overview

One-paragraph explanation: tickets are convention-discovered sandboxes spanning up to 3 layers, all optional.

### Decision Flowchart (dot format)

"What are you reproducing?" branching to which layers to create:

- UI-only bug → Frontend only
- Full-stack issue → Frontend + Server + Agent
- Agent behavior → Agent only (+ server if CopilotKit runtime needed)
- Need CopilotKit runtime bridge? → Add server handler

### Quick Reference Table

| Layer    | Location                              | Naming     | Key Export                             | Discovery                      |
| -------- | ------------------------------------- | ---------- | -------------------------------------- | ------------------------------ |
| Frontend | `app/client/src/tickets/tkt-<id>.tsx` | kebab-case | `meta: TicketMeta` + default component | `import.meta.glob`             |
| Server   | `app/server/tickets/tkt-<id>.ts`      | kebab-case | `handler` (CopilotKit endpoint)        | `readdirSync` + dynamic import |
| Agent    | `agent/tickets/tkt_<id>.py`           | snake_case | `app` (FastAPI sub-app)                | `pathlib.glob`                 |

### Key Contracts

- URL mapping: Server → `/api/tickets/tkt-<id>/copilot`, Agent → `/tickets/tkt-<id>`
- Frontend `meta.refs[0]` must be a valid URL (used for sidebar path derivation)
- Agent name in server handler must match Python agent name

### Common Mistakes

- Wrong case in filenames (kebab for TS, snake for Python)
- Missing `meta` export from frontend component
- Mismatched agent names between server and Python

## Out of Scope

- Boilerplate templates (reference existing `tkt-example` files instead)
- Ticket lifecycle management
- Deployment configuration
