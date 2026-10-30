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

| Stub                    | Why it is needed                                                                       | Fix                                               |
| ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pino`, `pino-pretty`   | Logger transports need `fs`, `worker_threads`                                          | PE-1105 (zero-dependency logger)                  |
| `@ai-sdk/google-vertex` | `google-auth-library` needs `child_process`, `fs`                                      | PE-1102 (factory-only BuiltInAgent)               |
| `yauzl`                 | Learned-skills archives need `fs`, `stream`, `zlib`                                    | PE-1107 blocker 5                                 |
| `crypto`                | `@ag-ui/a2ui-middleware`, `@ag-ui/mcp-apps-middleware`, `@copilotkit/license-verifier` | Upstream ag-ui PRs; license-verifier `/web` entry |

`src/worker.ts` also builds its agent per request. `@ag-ui/client` 1.0.3 and
earlier create a UUID in the agent constructor, and Workers do not allow that
in global scope. ag-ui `main` already fixes this. When a release with the fix
is out and the runtime uses it, build the agent at module scope.
