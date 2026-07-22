# Integration Checklist

Tagline: per-package source checklist + external setup (Railway, secrets, CI,
registry) for adding a new integration framework. Cross-ref:
`../examples/integrations/<slug>/` for canonical Dojo dep-pinning source.

Two checklists: what makes a **complete package**, and what **external setup** is needed when adding a new framework.

---

## Iron Rules (non-negotiable)

These govern ALL showcase cell work (integration, test, fixture, frontend). They exist because violating them causes divergence bugs across cells. `showcase/AGENTS.md` is the short canonical statement; this section is the deeper reference.

A showcase "cell" is one (integration × feature) pair. The core invariant: **a cell's behavior must be determined by the integration's backend + its fixture, and NOTHING else.**

1. **Identical tests — ONE shared probe.** The test measuring a feature (e2e/probe spec) is byte-identical across every integration; per-integration differences live ONLY in fixtures. For D6/D5 this is a single shared harness probe — e.g. `harness/src/probes/scripts/d5-gen-ui-a2ui-fixed.ts` — run against every integration. NEVER add a per-integration test copy.
2. **Near-identical frontends.** The feature UI is shared/near-identical so a cell renders the same regardless of backend (e.g. mastra ≡ langgraph-python frontend, byte-identical). Verify by screenshot/diff; don't diverge per-integration.
3. **Minimal backends.** Each integration's backend is the thinnest glue that drives the feature. No per-integration logic that belongs in shared — push it into `shared/`.
4. **Per-integration fixtures ONLY.** The only sanctioned per-integration variation is the aimock fixture: one per integration, keyed to its slug, under `aimock/d6/<slug>/...`.

### The single-source symlink mechanism (enforces rules 1 + 3)

`integrations/*/shared-tools/`, `*/tools/`, and `*/_shared/` are meant to be **SYMLINKS to `shared/...`** (single source of truth). `stage_shared()` in `scripts/cli/_common.sh` dereferences them to real files for the Docker build; `restore_symlinks()` restores them afterward.

- **EDIT THE SHARED SOURCE ONLY** (`showcase/shared/...`).
- A real file (not a symlink) under `shared-tools/` / `tools/` / `_shared/` is a **BUG** — it has drifted from shared. Check with `ls -l showcase/integrations/<slug>/shared-tools` (should show `-> ...`).
- This has ERODED on `main` (some paths are now real `100644` files that drifted) — that drift is the root cause of divergence bugs (e.g. the a2ui flat-vs-nested + `render_a2ui` vs `_design_a2ui_surface` split fixed in PR #5971).
- **NEVER "fix all N copies byte-identically."** Fix the shared source and restore the symlink.

### Value-test before merge (mandatory)

Run the real probe surface, not unit tests against fakes:

```
bin/showcase test <slug>:<feature> --d6 --direct
```

Observe RED (pre-fix) then GREEN (post-fix) on ≥3 real cells. Unit tests against fakes are NOT sufficient proof.

---

## A. Complete Package (what `pnpm create-integration` generates)

Everything below should exist in `showcase/integrations/<slug>/`:

### Source Files

- [ ] `manifest.yaml` — name, slug, category, language, features, demos, `deployed: false`, `generative_ui`, `interaction_modalities`, and optionally `managed_platform`
- [ ] Declare a feature-level `runtime_path` in `shared/feature-registry.json`
      when every backend uses the same non-default CopilotKit API route. Add a
      demo-level `runtime_path` override in `manifest.yaml` only when that
      integration differs. Registry generation materializes an explicit path
      for every demo and defaults to `/api/copilotkit`; `highlight` is display
      metadata and never controls runtime routing.
- [ ] `package.json` — dependencies including `@copilotkit/react-core`, `zod`, `tailwindcss`
- [ ] `tsconfig.json`
- [ ] `next.config.ts`
- [ ] `postcss.config.mjs`

### App Structure (`src/app/`)

- [ ] `layout.tsx` — imports `globals.css`, `copilotkit-overrides.css`, `@copilotkit/react-core/v2/styles.css`
- [ ] `globals.css` — NO `* { margin: 0; padding: 0; }` reset (only `box-sizing: border-box`)
- [ ] `copilotkit-overrides.css` — separate file for CopilotKit class overrides (survives Tailwind v4 purging)
- [ ] `api/copilotkit/route.ts` — runtime endpoint
- [ ] `api/health/route.ts` — health check endpoint
- [ ] `error-boundary.tsx` — DemoErrorBoundary component

### Demo Pages (`src/app/demos/<feature-id>/page.tsx`)

One per declared feature. Each demo must:

- [ ] Use `CopilotKit` provider with `runtimeUrl="/api/copilotkit"` and correct `agent` name
- [ ] Use `@copilotkit/react-core/v2` imports (NOT `@copilotkitnext/`)
- [ ] For `CopilotChat` demos: wrapper div with `px-6` for horizontal padding (matches Dojo)
- [ ] For `CopilotSidebar` demos: no extra padding needed (sidebar has built-in `px-8`)
- [ ] Use `h-full` not `h-screen` (demos render in iframes)
- [ ] Use inline styles for dynamic content (Tailwind v4 purges classes it can't statically find)
- [ ] Include `useConfigureSuggestions` with relevant suggestions

### Agent Backend

- [ ] Agent code in `src/agents/` (Python) or `src/lib/` (TypeScript)
- [ ] One agent per feature (names must match the `agent` prop in demo pages)
- [ ] `langgraph.json` (Python) or equivalent config
- [ ] **Pin framework versions** — see "Dependency Pinning" below
- [ ] **Per-request `X-AIMock-Strict` forwarding** — the agent's outbound LLM
      call to aimock MUST carry the inbound `X-AIMock-Strict` (+ `x-test-id`,
      `x-aimock-context`, `x-diag-*`) headers so a fixture MISS hard-fails
      instead of silently proxying to the real provider. Forward ONLY headers
      PRESENT inbound (never hardcode strict on); demo traffic without the
      header must still proxy. Missing this forwarding shows up as the **D3
      column flapping** (intermittent amber/red e2e cells) because the rendered
      answer is non-deterministic real-provider output. Precedent:
      `integrations/built-in-agent/src/lib/header-forwarding.ts` (ALS +
      `forwardingFetch`).
- [ ] **Two-process integrations** (a Next proxy route in front of a separate
      agent process): the header forwarder AND the CVDIAG emitter must live
      **agent-side**, not on the Next route (the Next route is a bare proxy and
      the transport may drop inbound `x-*` before the model call). The Next route
      forwards inbound `x-*` onto the proxy POST; the agent process recovers them
      via a middleware mounted before the framework handler. Worked example:
      `integrations/strands-typescript/src/agent/{header-forwarding,cvdiag-backend-strands}.ts`.

### Infrastructure

- [ ] `Dockerfile` — multi-stage, starts both agent backend and Next.js frontend
- [ ] **Two-process integrations: `COPY src/cvdiag` into the runner stage** — if
      the separate agent process imports the co-located emitter directly (e.g.
      `../cvdiag/cvdiag-emitter.js`), the `Dockerfile` MUST stage it into the
      image, e.g. `COPY --chown=app:app src/cvdiag ./src/cvdiag` right after the
      `COPY --chown=app:app src/agent ./src/agent`. Single-process integrations
      (`mastra`, `langgraph-typescript`, `claude-sdk-typescript`) get it via
      Next's `.next` bundling and don't need this. Omitting it passes local d6
      (where `bin/showcase cvdiag-stage-ts` materializes the emitter) but
      **crashes at boot in Docker/staging with `ERR_MODULE_NOT_FOUND:
.../src/cvdiag/cvdiag-emitter.js`**, so the D6 column never renders.
- [ ] `entrypoint.sh` — starts agent server and Next.js, waits for both

### Testing & QA

- [ ] `playwright.config.ts`
- [ ] `tests/` — one E2E test per demo (basic: load → send message → get response)
- [ ] `qa/` — manual QA checklist per demo
- [ ] **CVDIAG instrumentation staged** — add the slug to
      `_CVDIAG_TS_INTEGRATIONS` in `scripts/cli/cmd-cvdiag-stage-ts.sh`, run
      `bin/showcase cvdiag-stage-ts`, and verify `bin/showcase cvdiag-stage-ts
--check` exits 0 with zero drift (stages the co-located `src/cvdiag/`
      emitter into the standalone build context).
- [ ] **CVDIAG backend emitter wired** — the backend emits the 11 `backend.*`
      boundaries and persists them to the `cvdiag_events` PocketBase collection
      (`CVDIAG_BACKEND_EMITTER` / `CVDIAG_PB_URL` / `CVDIAG_WRITER_KEY` set on the
      service env). The emitter adopts the inbound `x-test-id` as the cross-layer
      JOIN key so its rows join the probe's. Verify with `bin/showcase cvdiag
classify <test-id>` returning non-empty after a probe run. For two-process
      integrations the emitter lives **agent-side** (see Agent Backend above).

### Assets

- [ ] Logo SVG at `showcase/shell/public/logos/<slug>.svg`

---

## Source of Truth: `examples/integrations/*` vs `showcase/integrations/*`

Two directories hold integration code, and they play different roles. Understanding the relationship is critical before adding or modifying a package.

### Roles

- **`examples/integrations/<name>/`** — the **Dojo example**. This is the dep-pinning source of truth: minimal, focused agent code used to prove a framework works against CopilotKit/AG-UI. The weekly drift-detection workflow and the "Always pin agent framework and SDK versions to exact versions from the working Dojo example" rule (see "Dependency Pinning" below) both treat this directory as canonical.
- **`showcase/integrations/<slug>/`** — the **full triple-duty integration**:
  1. Partner-facing demo (lives on `showcase.copilotkit.dev`)
  2. Cloneable starter source (extracted on-demand via `extract-starter.ts`)
  3. Iframe-embedded experience inside the public showcase shell

### Automation Direction (one-way)

```
examples/integrations/<name>/  ──(migrate-integration-examples.ts)──▶  showcase/integrations/<slug>/src/agents/
showcase/integrations/<slug>/  ──(extract-starter.ts)────────────────▶  standalone starter (on-demand)
```

- `showcase/scripts/migrate-integration-examples.ts` copies agent code **from** `examples/integrations/<name>/` **into** `showcase/integrations/<slug>/src/agents/`. It never runs in reverse.
- `showcase/scripts/extract-starter.ts` extracts a clean standalone starter from any integration on demand, dereferencing symlinks and stripping test/CI artifacts.
- Do not hand-edit agent code inside `showcase/integrations/<slug>/src/agents/` if the package has a Dojo counterpart — fix it upstream in `examples/integrations/<name>/` and re-run the migration script.

### Born-in-Showcase Packages (no Dojo counterpart)

Five packages exist only in showcase and have no `examples/integrations/<name>/` sibling:

- `ag2`
- `claude-sdk-python`
- `claude-sdk-typescript`
- `langroid`
- `spring-ai`

These are authored directly in `showcase/integrations/<slug>/` and are **exempt from the pin-to-Dojo rule** — there is no Dojo to pin to. They still must pin exact versions (see "Dependency Pinning"), but the reference is whatever the framework's own examples or release notes recommend, not a sibling `examples/integrations/` directory.

### Slug Aliasing

Several packages have different names in `examples/integrations/` vs `showcase/integrations/`. The aliasing is historical — showcase standardized on shorter, marketing-friendly slugs while the Dojo kept the original framework-canonical names.

| `showcase/integrations/` slug | `examples/integrations/` name | Why different                                             |
| ----------------------------- | ----------------------------- | --------------------------------------------------------- |
| `google-adk`                  | `adk`                         | Showcase prefixes with vendor for disambiguation          |
| `langgraph-typescript`        | `langgraph-js`                | Showcase prefers full language name (`-typescript`)       |
| `ms-agent-dotnet`             | `ms-agent-framework-dotnet`   | Showcase shortens `-framework-` out of the slug           |
| `ms-agent-python`             | `ms-agent-framework-python`   | Same — shorter slug in showcase                           |
| `strands`                     | `strands-python`              | Showcase drops the language suffix (no TS variant exists) |

When running `migrate-integration-examples.ts` or reasoning about drift, remember that the script internally maps these aliases — don't "fix" them by renaming one side.

---

## B. External Setup (after the package is ready)

This section is the **single-shot** bring-up: provision the prod Railway
service immediately, then go live. If instead you ship the integration
**staging-only first** and defer prod ("promote later"), follow
[`./RAILWAY.md`](./RAILWAY.md) → "Promoting a Staging-Only Integration to
Production" for the provision-prod-instance + SSOT-gate-flip + promote path
(and note: the promote pipeline does NOT provision a new prod service — D6
false-reds the whole column until the prod instance exists).

### 1. Railway Service

- [ ] Create service in the **CopilotKit Showcase** Railway project, **US-West** region
- [ ] Type: **Docker** (image from GHCR, not source build)
- [ ] Image URL: `ghcr.io/copilotkit/showcase-<slug>:latest`
- [ ] Health check path: `/api/health`
- [ ] Link shared variables group (contains API keys)
- [ ] Set `NODE_ENV=production`, `NEXT_PUBLIC_BASE_URL=https://showcase.copilotkit.dev`

### 2. GitHub Secrets

- [ ] Ensure `RAILWAY_TOKEN` secret exists in the repo

### 3. CI/CD Workflow (`.github/workflows/showcase_deploy.yml`)

- [ ] Add slug to `workflow_dispatch.inputs.service.options`
- [ ] Add change detection filter for `showcase/integrations/<slug>/**`
- [ ] Add build job: build Docker image → push to GHCR → trigger Railway deploy
- [ ] Wire up the `RAILWAY_TOKEN` secret

### 4. Registry

- [ ] Run `npx tsx showcase/scripts/generate-registry.ts` to regenerate `registry.json`
- [ ] Verify the integration appears on the Integrations page
- [ ] Verify demos load in the drawer (Preview tab)

### 5. Go Live

- [ ] Verify Railway service is healthy: `curl https://showcase-<slug>-production.up.railway.app/api/health`
- [ ] Verify all demos respond: visit each `/demos/<id>` route
- [ ] Set `deployed: true` in `manifest.yaml`
- [ ] Verify constraint validation passes: `npx tsx showcase/scripts/validate-constraints.ts <slug>`
- [ ] Regenerate registry: `npx tsx showcase/scripts/generate-registry.ts`
- [ ] Commit and push — stack nav chip will light up automatically

### 6. Shell Updates (usually automatic)

- [ ] If the framework name in the stack nav differs from `manifest.yaml` name, verify `startsWith` matching works
- [ ] Demo content (Code/Docs tabs): run `npx tsx showcase/scripts/generate-demo-content.ts` if it exists

---

## Dependency Pinning

**Always pin agent framework and SDK versions to exact versions from the working Dojo example.** Do not use floating ranges like `>=0.3.0` — they resolve to different versions over time and silently break APIs.

**Why this matters:** `langchain>=0.3.0` resolved to 0.3.x which lacked `create_agent`. The Dojo uses `langchain==1.2.0` where it exists. A floating range that worked at scaffold time broke on the next Docker build when a different version was pulled.

**What to pin:**

- Agent framework packages (langchain, langgraph, @mastra/core, etc.)
- CopilotKit SDK packages (copilotkit, @copilotkit/runtime, etc.)
- LLM provider SDKs (langchain-openai, @ai-sdk/openai, etc.)

**What can float:**

- Standard utilities (zod, react, next) — these have stable APIs
- Dev dependencies (playwright, typescript, tailwind)

**Where to find correct versions:**

- Check the corresponding Dojo example at `examples/integrations/<slug>/`
- Use exact versions from its `requirements.txt` / `pyproject.toml` / `package.json`
- The weekly drift detection workflow will flag when pinned versions fall behind

---

## LangGraph: Prebuilt vs Node-Based

LangGraph supports two agent authoring styles, and showcase uses both. When touching a LangGraph package — or adding a new one — decide the style explicitly and match the existing sibling's idioms.

### The Two Styles

- **Node-based** — hand-rolled `StateGraph` with `addNode(...)`, explicit edges, and custom routing logic. Maximum control; more code to maintain.
- **Prebuilt** — `create_react_agent` / `create_agent` helpers that wrap the common ReAct pattern. Minimal code; less flexibility.

### Current Showcase State

| Package                                      | Style      | Evidence                                              |
| -------------------------------------------- | ---------- | ----------------------------------------------------- |
| `showcase/integrations/langgraph-python`     | Prebuilt   | `create_react_agent` in `src/agents/main.py:53`       |
| `showcase/integrations/langgraph-fastapi`    | Prebuilt   | `create_react_agent` in `src/agents/src/agent.py:166` |
| `showcase/integrations/langgraph-typescript` | Node-based | `StateGraph` in `src/agent/graph.ts:271`              |

### Dojo Coverage Gap

The `ag-ui/apps/dojo/` e2e tests exclusively exercise **node-based** graphs. This means prebuilt-agent coverage is thin in the Dojo even though two of the three LangGraph packages users clone from showcase are prebuilt.

Cross-reference the action inventory for the full breakdown of which AG-UI features are exercised where: <https://www.notion.so/3443aa38185281b5a1dfc6e0890264e1>.

### Guidance

- **When adding a new LangGraph-based package**, decide the authoring style explicitly and match the idioms of the corresponding showcase sibling (Python → prebuilt, TypeScript → node-based) unless you have a concrete reason to diverge.
- If you do diverge, document why in the package's README and add an entry to the table above.
- Do not silently convert a package between styles — it's a public API change for anyone who cloned the starter.

This distinction only applies to LangGraph today. Other frameworks (CrewAI, Mastra, etc.) have their own framework-specific authoring idioms — out of scope for this section.

---

## Quick Reference: Common Gotchas

| Gotcha                            | Fix                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| CSS classes purged by Tailwind v4 | Put CopilotKit overrides in `copilotkit-overrides.css`, not `globals.css`                 |
| `* { margin: 0; padding: 0; }`    | NEVER use this reset — it strips CopilotKit's internal padding                            |
| Chat messages flush to edges      | Add `px-6` to the CopilotChat wrapper div                                                 |
| `h-screen` in demos               | Use `h-full` — demos render inside iframes                                                |
| Dynamic content unstyled          | Use inline `style={}` not Tailwind classes for agent-generated content                    |
| Stale lockfile                    | Run `pnpm install` after changing `package.json`, commit the lockfile                     |
| Stack chip not lighting up        | Check `deployed: true` in manifest and registry name matching                             |
| Agent import errors in Docker     | Pin framework deps to exact Dojo versions — floating ranges resolve differently over time |
