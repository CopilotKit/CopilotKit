# WebMCP × `useFrontendTool`

Strategy note. Source of truth: the [WebMCP CG draft](https://webmachinelearning.github.io/webmcp/)
(`index.bs`, Draft Community Group Report, 26 Aug 2026).

## Short answer

**Yes — it is accessible from React, and `useFrontendTool` is close to the ideal
integration point.** `document.modelContext` is an ordinary DOM API hanging off
`Document`; nothing about React, Next.js SSR, or the CopilotKit provider tree
blocks it. A `useEffect` that registers a tool and aborts on cleanup is exactly
the shape WebMCP was designed for.

Feasibility is verified, not assumed: `prds/webmcp-spike/` is a runnable
9-test proof that a tool registered through `useFrontendTool` becomes
discoverable and executable by an external agent, with correct schema,
cancellation, and unmount teardown.

The interesting question is not *can we* but *what breaks semantically* — the
answer is in [Impedance mismatches](#impedance-mismatches).

## Correct the record first

Most published WebMCP guidance is out of date. Verified against the current draft:

| Widely published | Actually in the current spec |
| --- | --- |
| `navigator.modelContext` | `document.modelContext` (`partial interface Document`) |
| `provideContext(...)` | **Does not exist.** Removed. |
| `unregisterTool(name)` | **Does not exist.** Unregister only by aborting the registration `AbortSignal`. |
| "returns a result object" | `executeTool()` resolves to a **`DOMString`** — the JSON-stringified result |

Building against blog-post APIs would produce code that does not run.

### The actual IDL

```webidl
partial interface Document {
  [SecureContext, SameObject] readonly attribute ModelContext modelContext;
};

[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject = {}, optional ModelContextExecuteToolOptions options = {});
  attribute EventHandler ontoolchange;
};

dictionary ModelContextTool {
  required DOMString name;
  USVString title;
  required DOMString description;
  object inputSchema;
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
```

## Two directions, not one

WebMCP is bidirectional, and the two directions serve different customers.

**Export — CopilotKit → WebMCP.** Mirror tools already registered via
`useFrontendTool` into `document.modelContext`, so *external* agents (the
browser's built-in agent, an extension, an in-page agent) can drive the app.
This is the headline: an app that adopted CopilotKit becomes agent-operable by
third-party agents **with no new tool definitions**.

**Import — WebMCP → CopilotKit.** Read tools published by *other* code on the
page (a third-party widget, an embedded iframe, a non-React island) via
`getTools()` + the `toolchange` event, and register them into CopilotKit's
registry so your own AG-UI agent can call them.

Export is the higher-value, lower-risk direction. Ship it first.

## Why `useFrontendTool` fits

The two models are close to isomorphic, which is unusual and worth exploiting.

| CopilotKit `FrontendTool` | WebMCP `ModelContextTool` | Fit |
| --- | --- | --- |
| `name` | `name` | needs sanitizing (see below) |
| `description` | `description` (required, non-empty) | direct |
| `parameters` (StandardSchema) | `inputSchema` (JSON Schema) | `schemaToJsonSchema()` already exists in `@copilotkit/shared` |
| `handler(args, ctx)` | `execute(inputObject, {signal})` | direct, both async |
| `ctx.signal` (abort on `stopAgent()`) | `options.signal` | **1:1** |
| `useLayoutEffect` cleanup | `registerTool(..., {signal})` abort | **1:1** |
| `available: false` | omit registration | direct |

Two of these are genuinely lucky. WebMCP's only unregistration mechanism is an
`AbortSignal`, which is precisely a React cleanup function. And
`useHumanInTheLoop` already threads an `AbortSignal` into its handler and
rejects on abort — so cancellation semantics line up without redesign.

The schema conversion is already solved: `createToolSchema()` in
`run-handler.ts` produces exactly the draft-07 object WebMCP's `inputSchema`
wants.

## Impedance mismatches

These are the real work. Each has a recommended resolution.

**1. There is no AG-UI run behind a WebMCP call.**
`FrontendTool.handler` receives `{ toolCall, agent, signal }`. When an external
agent invokes the tool there is no tool call, no agent, no run. Most handlers
only read `args`, so a synthesized context works — but it must be honest.
*Recommendation:* synthesize `toolCall`, pass the resolved agent, and add an
additive discriminant `ctx.source: "agent" | "webmcp"` so handlers can branch.
Document that `agent` may be undefined under `"webmcp"`.

**2. Rejection reasons are destroyed.**
On a rejected `execute()`, the spec runs `completionSteps(null, false)` and only
*optionally* logs to console. The error message never reaches the agent.
*Recommendation:* the bridge must **catch handler errors and resolve** with a
structured payload (`{ ok: false, error }`) so the agent can read and recover.
Reserve rejection for cancellation only — conflating the two was a real bug
caught by the spike's test suite.

**3. Duplicate-name semantics are opposite.**
`registerTool` **rejects** with `InvalidStateError` on a duplicate name.
`useFrontendTool` **overrides** (warns, removes, re-adds). A naive mirror
throws on every hot-reload and every keyed remount.
*Recommendation:* the bridge owns one `AbortController` per exported name;
re-registration aborts the old one first.

**4. Name charset.**
WebMCP: 1–128 chars, `[A-Za-z0-9_.-]` only. CopilotKit names are free-form.
*Recommendation:* sanitize and truncate, detect post-sanitization collisions,
warn once. (`"search products (beta)!"` → `"search_products__beta__"`.)

**5. Rendered and HITL tools have no surface.**
`render` and `useHumanInTheLoop` depend on the CopilotKit chat thread. An
external agent invoking a HITL tool would wait on a `respond()` that can never
be called, hanging until abort.
*Recommendation:* **exclude HITL tools from export by default.** Opt-in only,
and only with a non-chat surface — see below.

**6. Agent scoping has no analogue.**
`agentId` scopes a tool to one agent; WebMCP has no agent concept.
*Recommendation:* export only unscoped (global) tools by default; require
explicit opt-in for agent-scoped ones.

**7. Export + import together is a feedback loop.**
`getTools()` returns tools from the current document *and its descendants* — so
your own exported tools come back. Import them and you re-export them.
*Recommendation:* tag imported tools and filter them from export. The spike
covers this with a `__fromWebMCP` guard and a regression test.

**8. Core has no tool-change notification.**
`CopilotKitCoreSubscriber` exposes `onAgentsChanged`, `onContextChanged`,
`onCatalogComponentsChanged` — but **no `onToolsChanged`**. A provider-level
bridge cannot currently learn that the registry changed.
*Recommendation:* add `onToolsChanged` and emit it from `addTool` / `removeTool`
/ `setTools`. Small, additive, and directly precedented by
`onCatalogComponentsChanged`. **This is the one required core change.**

## Deployment prerequisites

Easy to miss, and each one is a hard failure:

- **Secure context.** `[SecureContext]` — HTTPS or localhost.
- **Origin-keyed agent cluster.** `registerTool`, `getTools`, and `executeTool`
  all reject with `SecurityError` unless the agent cluster is origin-keyed
  (or the scheme is `file:`). In practice this means serving
  **`Origin-Agent-Cluster: ?1`**. Nothing in the API hints at this; it will look
  like an inexplicable `SecurityError` in production.
- **Permissions Policy.** Gated on the `tools` feature, default allowlist
  `'self'`. Cross-origin iframes need `allow="tools"`, and cross-origin exposure
  additionally needs `registerTool(..., { exposedTo: [...] })` plus
  `getTools({ fromOrigins: [...] })`.

## Recommended shape

Three options considered:

- **A — provider-level auto-bridge.** `<CopilotKitProvider webmcp>` mirrors every
  eligible tool. Zero changes to existing call sites.
- **B — per-tool opt-in.** `useFrontendTool({ ..., webmcp: true })`. Explicit, but
  every call site must be touched.
- **C — separate hook.** `useWebMCPTool(...)`. Clean, but duplicates the registry
  and abandons the "existing flow" goal.

**Recommend A with a per-tool opt-out**, which is what the spike implements. It
matches the ask — integrate WebMCP into an *existing* AG-UI flow — and keeps one
registry as the single source of truth. `webmcp: false` on a tool, or a
`webmcp={{ include }}` predicate on the provider, covers the escape hatches.

Safety argues for one deviation from pure auto-export: default to exporting only
tools whose author has said something about intent. Concretely, export
`readOnlyHint`-annotatable tools freely, but require opt-in for anything
mutating — WebMCP's own security section treats tool metadata, inputs, and
outputs as prompt-injection vectors, and an auto-exported `deleteAccount` is a
liability. `ToolAnnotations { readOnlyHint, untrustedContentHint }` is the
spec's mechanism for signalling this; plumb it through as
`tool.webmcp.annotations`.

## The import path is nearly free

`FrontendTool.parameters` expects a `StandardSchemaV1`, and WebMCP hands you raw
JSON Schema. Rather than a JSON-Schema→Zod compiler, wrap it — `schemaToJsonSchema()`
already prefers `~standard.jsonSchema.input()`, so a pass-through satisfies core
with **no core changes at all**:

```ts
const jsonSchemaToStandardSchema = (schema) => ({
  "~standard": {
    version: 1,
    vendor: "webmcp",
    validate: (value) => ({ value }),
    jsonSchema: { input: () => schema },
  },
});
```

Verified by test in the spike. Validation is deferred to the model/agent, which
matches how `createToolSchema` already treats provider schemas.

## HITL is the actual product opportunity

WebMCP's stated purpose is *collaborative* workflows — user and agent in the same
interface — not headless automation. CopilotKit already has the hard part built:
`useHumanInTheLoop` renders interactive UI mid-tool-call and resolves a promise
on user input, with abort support.

The gap is only that its surface is the chat thread. Give HITL rendering a
non-chat surface (a docked panel or dialog driven by an active WebMCP execution)
and CopilotKit becomes the most complete HITL story on the platform: an external
browser agent calls a tool, *your* React component renders in *your* app, the
user confirms, and the result returns to an agent that was never yours.

That is a differentiator, not a port. It is also strictly more work than the
export bridge — sequence it after.

## Phasing

1. **Core:** add `onToolsChanged`. (Small, additive, independently useful.)
2. **Export bridge** behind `<CopilotKitProvider webmcp>`, off by default:
   name sanitizing, schema conversion, abort-based teardown, structured errors,
   HITL excluded, mutating tools opt-in. Ship with the `Origin-Agent-Cluster`
   requirement documented prominently.
3. **Import bridge:** `getTools()` + `toolchange`, StandardSchema pass-through,
   loop guard, iframe/`fromOrigins` support.
4. **HITL surface** for agent-initiated tool calls.

Gate 2–4 on the origin trial holding its shape; the API has already moved once
(`navigator` → `document`, `provideContext` removed), so keep the bridge as a
thin, replaceable adapter and avoid leaking WebMCP types into public API.

## Open questions

- Does the origin trial's shipped surface match this draft, or still serve
  `navigator.modelContext`? Verify against a real Chrome before implementing.
- Should exported tools be scoped per-agent when multiple agents are mounted, or
  flattened? Flattening loses routing; scoping has no spec representation.
- `title` is `USVString` for native UI display — worth adding a
  `tool.webmcp.title` rather than reusing `description`.
- No `outputSchema` in the current draft; results are opaque stringified JSON.
