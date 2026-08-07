# BEFORE-MERGE.md

Things to undo / resolve before this OpenClaw showcase integration is merged into
**main CopilotKit**. This integration was built against an **unpublished fork of
ag-ui** and a local **test harness** (aimock + a hand-configured gateway), so a
few things here are scaffolding, not product.

Owner: @markus · Last updated: 2026-07-08

---

## 1. Publish `ag-ui` and de-vendor it — **BLOCKER**

The plugin source lives in a fork: `@contextableai/ag-ui@0.7.0`
(github.com/contextable/ag-ui, branch `rd-53-showcase-fork`). It is **not
published to npm**, so the showcase carries a **vendored build** of it and
installs that build into the gateway.

- `gateway/ag-ui/` — the entire vendored fork (its compiled `dist/`, plus a
  copied `node_modules`). `gateway/ag-ui/dist/src/http-handler.js` etc. are
  **compiled artifacts**, not hand-edited. They must be kept byte-identical to a
  fresh `npm run build` of the fork (**drift risk** — source in the fork repo,
  build committed here).
- `gateway/setup.sh` installs it with `openclaw plugins install "$AG_UI_DIR"`
  and then copies its `node_modules` into `~/.openclaw/extensions/ag-ui`
  (because `plugins install` doesn't always bring deps).

**To undo:** publish the fork (or merge it upstream into OpenClaw), then:

- [ ] delete `gateway/ag-ui/` entirely
- [ ] in `setup.sh`, replace the vendored install with a versioned install
      (`openclaw plugins install @contextableai/ag-ui@<version>`) or a normal
      dependency
- [ ] remove the `node_modules`-copy workaround in `setup.sh`
- [ ] delete the drift-sync step from any dev docs

> This vendored copy exists **only** because the fork is unpublished. Publishing
> it removes this whole item.

---

## 2. Move `OpenClawAgent` to the AG-UI repo

`src/lib/openclaw-agent.ts` defines a **local placeholder** client class:

```ts
class OpenClawAgent extends HttpAgent {} // zero added logic
```

Provenance: authored by Lukas directly in this showcase (commit `548047e40`,
2026-07-05, _"route openclaw through an OpenClawAgent client class"_). It is
**not** an installed package — `@ag-ui/openclaw` is unpublished (npm 404) and no
`integrations/openclaw` exists on any `ag-ui-protocol/ag-ui` branch or the
Contextable forks. The file's own comment says it's a mirror to be deleted "once
it's published."

The intended shape follows the real `@ag-ui/<framework>` convention (e.g.
`@ag-ui/mastra` is a published integration package the showcase already uses).

**To do:**

- [ ] Create `integrations/openclaw` in `ag-ui-protocol/ag-ui` exporting
      `OpenClawAgent` (publish as `@ag-ui/openclaw`), mirroring `@ag-ui/mastra`.
      Carry over the operator-route URL + bearer-token wiring currently in
      `openclaw-agent.ts` (`createGatewayAgent`).
- [ ] Add `@ag-ui/openclaw` as a showcase dependency and replace the local class
      with `import { OpenClawAgent } from "@ag-ui/openclaw"`.
- [ ] Delete the local mirror in `src/lib/openclaw-agent.ts` (keep only the
      showcase-specific `createGatewayAgent` wiring, or move that upstream too).

> Same class of item as #1: a local stand-in for an unpublished upstream
> artifact. Independent of #1 (different repo: AG-UI, not ag-ui).

---

## 3. Clean up the fork before publishing it

These live in the fork repo (`ag-ui`), but they gate #1:

- [ ] Strip `[ag-ui]` debug `console.log`s (~33 across `index.ts`,
      `src/client-tools.ts`, `src/tool-store.ts`, `src/http-handler.ts`).
- [ ] `markClientToolNames` is exported but **never called in production**, so
      `isClientTool` is always false. Either wire it up or remove it (and the
      now-dead client-vs-server branch in the `before_tool_call` hook).
- [ ] `runtime.config.loadConfig()` is deprecated upstream — switch to
      `config.current()`.

---

## 4. `gateway/showcase-tools/` — decide: keep as fixture or productize

A separate **vendored** backend tool plugin providing the demos' server-side
tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_d20`,
`get_revenue_chart`, `query_data`, `display_flight`). It's intentionally separate
from ag-ui (keeps the adapter clean).

- [ ] Decide whether it ships as demo scaffolding (fine to keep vendored, but
      label it clearly as a showcase fixture) or becomes its own package.
- [ ] Its tool names are hard-allowed in `setup.sh` via `tools.alsoAllow` — keep
      that list in sync with the plugin's `contracts.tools`.

---

## 5. `@ts-ignore` on `CopilotRuntime.agents` — verify once on main

Many routes carry:
`// @ts-ignore -- Published CopilotRuntime agents type wraps Record in
MaybePromise<NonEmptyRecord<...>> ...; fixed in source, pending release`
(e.g. `src/app/api/copilotkit/route.ts`, `copilotkit-voice`,
`copilotkit-a2ui-fixed-schema`, `copilotkit-headless-complete`, …).

- [ ] On main CopilotKit the fixed runtime **source** is present, so these
      `@ts-ignore`s are likely unnecessary. Remove them and confirm `tsc` passes
      against the workspace `@copilotkit/runtime`.
- [ ] The `// @ts-ignore -- see main route.ts` copies inherit the same fate.
- [ ] `next.config.ts` sets `typescript.ignoreBuildErrors: true`, which masks
      type regressions beyond these targeted `@ts-ignore`s. It can't simply be
      removed — the same published-package type drift currently fails a strict
      build. Once the drift above is resolved, drop `ignoreBuildErrors`.

---

## 6. Re-evaluate the excluded demos under Option B — **important**

`manifest.yaml` `not_supported_features` excludes a set of demos (tool-rendering
cluster, `gen-ui-tool-based`, `frontend-tools-async`, `a2ui-dynamic-schema`,
`auth`, `voice`, …). **Several of those exclusion rationales predate the Option B
refactor** and explicitly reason about behavior that no longer exists:

> "our **stateless** client-tool runs use a **fresh session each turn**"
> (tool-rendering loop rationale)

Option B changed exactly this: every turn now runs through `runEmbeddedAgent`
against a **persistent** per-conversation session, so aimock receives **real
role-structured messages** (user / assistant / toolResult) from the transcript
instead of the old flattened `"User: … Assistant called tool …"` mega-prompt.
That is the layer the excluded tool-loop analysis blamed.

- [ ] Re-run the excluded specs (esp. `tool-rendering`, `tool-rendering-*`,
      `a2ui-dynamic-schema`) under the current build — the tool-loop root cause
      may have shifted or resolved. Do **not** trust the current rationale text.
- [ ] Update `manifest.yaml` (`features` / `not_supported_features`) and
      `PARITY_NOTES.md` to reflect the Option B reality (the "stateless / fresh
      session" language is now inaccurate).

---

## 7. Test-harness config in `setup.sh` — review (mostly keep)

`setup.sh` is container setup for the showcase; most is legitimate, but it bakes
test-harness assumptions that reviewers should see:

- [ ] Routes the OpenAI provider at `OPENAI_BASE_URL` (aimock) **when set**, and
      bakes a static `X-AIMock-Context: openclaw` provider header. When
      `OPENAI_BASE_URL` is unset it uses real OpenAI (header still baked but
      harmless). Confirm this is the intended prod/demo behavior.
- [ ] Seeds `~/.openclaw/workspace/IDENTITY.md` + `AGENTS.md` and sets
      `skipBootstrap: true` to suppress OpenClaw's first-run identity ritual.
      Keep, but note it's opinionated agent-prompt seeding.
- [ ] `reasoningDefault: "stream"` and the intermittent-reasoning caveat (see
      `PARITY_NOTES.md`) are OpenClaw-core limitations, not fixable here.
- [ ] **Config-injection footgun (CR):** the JSON heredocs in `setup.sh`
      interpolate `$TOKEN`/`$PORT`/`$OPENAI_BASE_URL` unescaped. Operator-set
      values with a `"`, `}`, or newline corrupt the config (not
      attacker-reachable, so left as-is). Fix with `jq -n --arg` if a container
      `jq` is guaranteed, or validate/quote before merge.

---

## 8. Misc

- [ ] `src/lib/openclaw-agent.ts` defaults the gateway to
      `http://127.0.0.1:8000/v1/ag-ui/operator` with an env override — fine
      for local/container; confirm the deploy target sets the env.
- [ ] `OPENCLAW_GATEWAY_TOKEN` is a shared bearer baked at setup — ensure it's a
      real secret in any hosted deploy, not a checked-in default.

---

## Not an undo item (context)

The **Option B** change itself (unify on `runEmbeddedAgent` + persistent
sessions + delta prompt, delete the `dispatchReplyFromConfig`/MsgContext branch)
is an intentional improvement to the adapter, not scaffolding. It lives in the
fork (`src/http-handler.ts`) and ships via the vendored build until #1 is done.
See the fork's commit and `PARITY_NOTES.md`.
