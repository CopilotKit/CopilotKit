# WebMCP feasibility spike

Throwaway proof supporting [`../webmcp-usefrontendtool-integration.md`](../webmcp-usefrontendtool-integration.md).
Not part of the pnpm workspace, not built, not shipped. Standalone on purpose so
it can be deleted in one `rm -rf` once the real bridge lands.

```bash
cd prds/webmcp-spike && npm install && npm test
```

## What it proves

`modelcontext-shim.js` is a spec-faithful shim of `document.modelContext`
(CG draft, 26 Aug 2026) — real duplicate-name rejection, real name validation,
`AbortSignal`-only unregistration, stringified `executeTool` results, and the
spec's dropping of rejection reasons. `core-mock.jsx` mirrors the tool-registry
semantics of `packages/core/src/core/run-handler.ts` and the registration half
of `use-frontend-tool.tsx`. `bridge.jsx` is the proposed adapter.

The 9 tests establish that:

- a tool registered with `useFrontendTool` is discoverable by an external agent,
  with a correct draft-07 `inputSchema` derived from its Zod schema;
- that agent can execute it and reach the CopilotKit handler;
- React unmount unregisters it via `AbortSignal` (cleanup maps 1:1);
- handler errors survive as structured data, because the spec discards
  rejection reasons;
- cancellation propagates into the handler's signal — the HITL path;
- `available: false` and `webmcp: false` suppress export;
- illegal characters in tool names are sanitized to WebMCP's charset;
- raw JSON Schema round-trips through a `StandardSchemaV1` pass-through,
  so the import direction needs no core changes;
- imported tools are never re-exported (feedback-loop guard).

The shim is a test double, not a polyfill. Verify against a real Chrome before
implementing — the API has already moved once.
