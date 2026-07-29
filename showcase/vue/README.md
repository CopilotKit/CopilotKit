# Vue Showcase host

This project is the static Vue host for CopilotKit Showcase journeys. The
current foundation implements only the `agentic-chat` route and remains
fail-closed until Vue is activated in the frontend registry and staged into
the integration hosts.

Run project checks through Nx from the repository root:

```sh
pnpm nx run @copilotkit/showcase-vue-host:test
pnpm nx run @copilotkit/showcase-vue-host:build
pnpm nx run @copilotkit/showcase-vue-host:consumer-check-types
```

Tests and the production build are blocking gates. `consumer-check-types` is
an observational audit that runs strict, unmodified `vue-tsc --noEmit` and
returns its real exit status. It currently exposes existing external
declaration failures while the Showcase host itself remains buildable and
tested; those diagnostics are intentionally neither filtered nor suppressed
here.
