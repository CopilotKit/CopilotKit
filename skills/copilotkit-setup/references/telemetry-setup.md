# Connecting CopilotKit Intelligence

## What is CopilotKit Intelligence?

CopilotKit Intelligence is CopilotKit's hosted platform. It provides:

- **Durable threads** -- conversation history persisted across sessions, with
  the thread routes the client needs to list and resume them
- **Usage analytics** -- message volume, tool usage, session duration
- **Error monitoring** -- runtime errors and failed agent interactions
- **Premium features** -- hosted runtimes and advanced agent orchestration
  (paid plans)

It does not gate any open-source functionality. CopilotKit works fully
without it.

## It is configured on the runtime, not on the provider

There is no client-side key. The credential is a server-side runtime key, and
it never reaches the browser. Nothing changes in your React code when you
connect or disconnect Intelligence.

Do not reach for `publicApiKey` or `publicLicenseKey` for this. Those props
route a runtime-less client at **CopilotKit Cloud**
(`api.cloud.copilotkit.ai`), which is a different product.

## The CLI flow

```bash
npx copilotkit login
npx copilotkit project select
```

1. `login` opens your browser to sign in with GitHub, Google, or email.
2. `project select` picks or creates a hosted project and records it in
   `.copilotkit/project.json`.
3. The CLI provisions a project-scoped runtime key and writes it to `.env`.

If the browser does not open, the CLI prints a URL to paste manually.

There is no `copilotkit auth` command. The command is `login`.

## What the CLI writes

```
INTELLIGENCE_API_URL=https://...
INTELLIGENCE_GATEWAY_WS_URL=wss://...
INTELLIGENCE_API_KEY=cpk_...
```

Keep `INTELLIGENCE_API_KEY` server-side. It is a runtime key for the selected
project, not a frontend token, so it takes **no** `NEXT_PUBLIC_` or `VITE_`
prefix. A prefixed copy would ship the credential in the browser bundle.

## Verifying the connection

```bash
npx copilotkit verify
```

It reports whether a project is selected, whether the key loads and
authenticates, whether the runtime is actually using the credential, and
whether the runtime serves the thread routes that saved threads need.

## Opting out

Remove the `INTELLIGENCE_*` variables from the runtime's environment. No
frontend change is needed, because no frontend code referenced them.
