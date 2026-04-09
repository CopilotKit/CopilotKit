# Integration Checklist

Two checklists: what makes a **complete package**, and what **external setup** is needed when adding a new framework.

---

## A. Complete Package (what `pnpm create-integration` generates)

Everything below should exist in `showcase/packages/<slug>/`:

### Source Files

- [ ] `manifest.yaml` — name, slug, category, language, features, demos, `deployed: false`, `generative_ui`, `interaction_modalities`, and optionally `managed_platform`
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

### Infrastructure

- [ ] `Dockerfile` — multi-stage, starts both agent backend and Next.js frontend
- [ ] `entrypoint.sh` — starts agent server and Next.js, waits for both

### Testing & QA

- [ ] `playwright.config.ts`
- [ ] `tests/` — one E2E test per demo (basic: load → send message → get response)
- [ ] `qa/` — manual QA checklist per demo

### Assets

- [ ] Logo SVG at `showcase/shell/public/logos/<slug>.svg`

---

## B. External Setup (after the package is ready)

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
- [ ] Add change detection filter for `showcase/packages/<slug>/**`
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
