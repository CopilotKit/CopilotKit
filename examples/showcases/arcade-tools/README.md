# Arcade × CopilotKit Cookbook

> Give CopilotKit's Built-in Agent **authenticated tools** (Gmail, Google News) through
> [Arcade](https://www.arcade.dev), and render the OAuth step as **generative UI** in the chat.

Arcade is the MCP runtime for production agents: it brokers per-user OAuth, vaults and
refreshes tokens, and runs agent-optimized tools, all without the credentials ever
touching the LLM. CopilotKit is the frontend stack for agents: chat, streaming, and
generative UI.

Put them together and you get the demo in this repo: an agent that can **send email and
read your inbox**, where the one-time "connect your account" step shows up as a card
right in the conversation. Approve it once and the agent completes the action.

![The agent renders an Arcade "Connect" card when a tool needs authorization, then completes the action once you approve.](./public/preview.svg)

---

## What's inside

| Path                          | What it does                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `lib/arcade.ts`               | `runArcadeTool()`, the authorize-then-execute helper around the Arcade SDK       |
| `app/api/copilotkit/route.ts` | The CopilotKit runtime (single-route): 3 Arcade-backed tools on a Built-in Agent |
| `app/page.tsx`                | Server entry that reads env for the keys banner and renders the client UI        |
| `app/home-client.tsx`         | The chat + `useRenderTool` renderers that turn tool calls into cards             |
| `components/tool-cards.tsx`   | The generative UI: `AuthorizationCard`, sent / inbox / news cards                |
| `app/mock/page.tsx`           | A static preview of every card, no keys or agent required (`/mock`)              |
| `app/providers.tsx`           | The `<CopilotKit>` v2 provider (single-route)                                    |

The cookbook write-up lives in the docs at
[`showcase/shell-docs/src/content/docs/cookbook/arcade.mdx`](../../../showcase/shell-docs/src/content/docs/cookbook/arcade.mdx).

The three tools:

- **`searchNews`** maps to `GoogleNews.SearchNewsStories`, no auth, returns instantly.
- **`sendEmail`** maps to `Gmail.SendEmail`, needs a one-time Gmail connection.
- **`listEmails`** maps to `Gmail.ListEmails`, same Gmail connection.

They chain: _"Find the latest news on open-source AI agents and email me a 3-bullet summary."_

---

## Quickstart

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy the example and fill in your keys:

```bash
cp .env.example .env.local
```

```bash
# Arcade: https://api.arcade.dev/dashboard
ARCADE_API_KEY=arc_...
ARCADE_USER_ID=you@example.com   # the user Arcade acts on behalf of

# Model: https://platform.openai.com
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=openai/gpt-4o     # optional override ("provider/model")

# CopilotKit runtime sends anonymous telemetry by default. Opt out:
COPILOTKIT_TELEMETRY_DISABLED=true
```

> `ARCADE_USER_ID` is required in production: the app **fails closed** if it's unset, because
> a shared id would put every end user on one Arcade token vault (cross-account access). The
> `demo-user@example.com` fallback only applies in development.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and try one of the suggested prompts -
or _"Send an email to me@example.com saying hello from my agent."_ The first time, you'll
get a **Connect Gmail** card; approve it in the new tab, come back, say _"continue,"_ and
the agent sends the email.

---

## How the authorization flow works

The whole pattern lives in `runArcadeTool()`:

1. **Authorize.** `arcade.tools.authorize({ tool_name, user_id })` asks Arcade whether this
   user has already granted the scopes the tool needs. No-auth tools come back
   `"completed"` immediately.
2. **Hand the URL to the UI.** If authorization is still pending, we **don't block** the
   run, and instead return `{ authorizationRequired: true, authUrl }`. CopilotKit's `useRenderTool`
   sees that result and renders the `AuthorizationCard` with a **Connect** button.
3. **Execute.** After the user approves and asks the agent to continue, the next call sees
   `"completed"` and runs `arcade.tools.execute(...)`. The tool runs with the user's vaulted
   credentials; the model only ever sees the structured result.

```text
agent calls sendEmail
        │
        ▼
 authorize(user, "Gmail.SendEmail")
        │
   status == "completed"? ──no──▶ return { authorizationRequired, authUrl }
        │                                  │
       yes                          <AuthorizationCard> renders a "Connect" button
        │                                  │
        ▼                          user approves in a new tab → "continue"
 execute(...) → result                     │
        │                                  └──────────────▶ agent re-calls the tool
        ▼
 <EmailSentCard> renders
```

Because authorization is **per user**, this is exactly how you'd run a multi-tenant agent:
the route resolves a user id per request (`resolveArcadeUserId`) and Arcade scopes every
action to it. Wire that to your real session and each end user gets their own vault.

---

## Customizing

- **Add tools.** Browse [Arcade's tool catalog](https://www.arcade.dev/tools) (GitHub,
  Slack, Notion, Google Calendar, …), add a `defineTool` wrapper in the route that calls
  `runArcadeTool` with the new tool name (match its param names to the Arcade tool's schema,
  or they're silently dropped), and register a `useRenderTool` renderer (or rely on the
  generic fallback) in `app/page.tsx`.
- **Scale past a handful.** Arcade is a runtime, not a single connector. Pull formatted
  tool definitions from Arcade to generate wrappers, or front your tools with an
  OAuth-protected [MCP gateway](https://docs.arcade.dev) for the production shape.
- **Swap the model.** Set `OPENAI_MODEL` (e.g. `anthropic/claude-sonnet-4.5`,
  `google/gemini-2.5-pro`). See CopilotKit's Built-in Agent model identifiers.
- **Real users.** Replace `getArcadeUserId()` with your authenticated user's id, derived
  per-request from your session (the app already fails closed if it's unset in production).

---

## Security & deploying publicly

This is a **demo**. It runs great locally, but the agent runtime can **send and read
email on your keys**, so don't expose it raw on the public internet. Before you deploy:

- **Protect the runtime.** `/api/copilotkit/*` is unauthenticated by default, so anyone who
  can reach it can drive the agent on your keys. Set `COPILOTKIT_RUNTIME_TOKEN` for a
  starter bearer-token gate (`onRequest` in the route), or better, replace it with your
  real session auth. Never deploy without auth in front of it.
- **Scope every user.** Tool calls are scoped to the id from `resolveArcadeUserId(request)`.
  In production, derive it from a **server-verified session** (validated cookie/JWT), not a
  client header (those are spoofable). A single shared `ARCADE_USER_ID` across visitors means
  one shared Gmail vault, which is cross-account access. The app fails closed in production if
  the id is unset.
- **Use disposable keys.** For any public/live demo, use a throwaway Arcade project key, a
  scoped OpenAI key, and a throwaway Google account, never production credentials. Keys live
  only in `.env.local`, which is gitignored; keep it that way (don't `git add -f`).
- **Add rate limiting & spend caps.** Unauthenticated, multi-step (`maxSteps`) runs can burn
  your OpenAI/Arcade quota. Add per-IP/session limits and billing alerts.
- **Already wired here:** errors are sanitized in production (`lib/arcade.ts`), all external
  links are scheme-validated (`safeHttpUrl`), security headers are set in `next.config.ts`
  (tighten the CSP with nonces for production), and telemetry is opt-out via
  `COPILOTKIT_TELEMETRY_DISABLED`.

---

## Tech

- [CopilotKit](https://docs.copilotkit.ai) `@copilotkit/react-core` + `@copilotkit/runtime` (v2 API)
- [Arcade](https://docs.arcade.dev) `@arcadeai/arcadejs`
- Next.js (App Router) · React 19 · Tailwind CSS · Zod

## License

MIT
