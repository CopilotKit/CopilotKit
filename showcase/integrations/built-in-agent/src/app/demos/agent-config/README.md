# Agent Config (built-in-agent)

Frontend forwards typed config (`tone`, `expertise`, `responseLength`)
through the `<CopilotKitProvider properties={...}>` prop. The runtime puts
that on `input.forwardedProps`, and the built-in-agent factory reads it to
synthesize a tuned system prompt per turn — no external graph, no extra
state plumbing.

- Dedicated route: `/api/copilotkit-agent-config`
- Single-route mode (`useSingleEndpoint`)
- Key files: `page.tsx`, `config-card.tsx`, `use-agent-config.ts`,
  `config-types.ts`, `../../api/copilotkit-agent-config/route.ts`
