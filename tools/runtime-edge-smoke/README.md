# Runtime edge smoke test

Runs `@copilotkit/runtime` on two edge runtimes and checks that it serves
`GET /info` and streams a run:

- Cloudflare Workers, on workerd through wrangler, **without** `nodejs_compat`.
- The Vercel Edge runtime (the `edge-runtime` VM that Vercel and Next.js use
  locally), bundled with the `edge-light` condition.

It also checks that the runtime's own ESM output imports no Node built-in
outside the `@copilotkit/runtime/node` entry point.

```sh
pnpm nx run runtime-edge-smoke:smoke
```

The test needs no model key. `src/worker.ts` uses an echo agent.

## Stubs

Some dependencies still need Node. Each one has its own fix, so the test stubs
it to check the rest of the runtime now. The list is in `wrangler.jsonc`
(`alias`) and in `run.mjs` (`STUBS`). Keep the two lists the same. When a fix
lands, remove its stub. The test then proves the fix.

| Stub     | Why it is needed                                                                       | Fix                                               |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pino`   | Logger transports need `fs`, `worker_threads`                                          | PE-1105 (zero-dependency logger)                  |
| `crypto` | `@ag-ui/a2ui-middleware`, `@ag-ui/mcp-apps-middleware`, `@copilotkit/license-verifier` | Upstream ag-ui PRs; license-verifier `/web` entry |

`src/worker.ts` also builds its agent per request. `@ag-ui/client` 1.0.3 and
earlier create a UUID in the agent constructor, and Workers do not allow that
in global scope. ag-ui `main` already fixes this. When a release with the fix
is out and the runtime uses it, build the agent at module scope.

## BuiltInAgent on Workers

The test does not run `BuiltInAgent`. A model string such as `"openai/gpt-5"`
loads its adapter package with a runtime `import()`, and Workers cannot do
that. On Workers, import `BuiltInAgent` from `@copilotkit/runtime/agent` and
give it a factory (`type: "tanstack"` or `type: "custom"`) or a TanStack AI
adapter instance as `model`.
