# Showcase Platform

Per-framework demos of CopilotKit (LangGraph, CrewAI, Mastra, Claude Agent SDK, etc.). Each package is a Next.js frontend + agent backend bundled in a Docker image. Railway deploys those images from `main` on push. This README is the from-scratch setup for running the same stack locally.

## Layout

```
showcase/
  packages/<slug>/              # one per framework (17 total) — Dockerfile, src/app/demos/*/, src/agents/ or equivalent
  shell/                        # hub: home page, /matrix, canonical /integrations/[slug]/[demo]/{preview,code}
  shell-dashboard/              # internal-only feature × integration grid (port 3002)
  shared/
    feature-registry.json       # canonical features + categories (feeds the grid rows)
    constraints.yaml            # allowlist for which demos a package can expose
    local-ports.json            # deterministic host ports per package for local Docker runs
    python/ typescript/tools/   # shared agent utility code; CI stages these into each build context
  scripts/
    dev-local.sh                # local Docker workflow (see below)
    generate-registry.ts        # builds shell/src/data/registry.json from all manifest.yaml
    bundle-demo-content.ts      # bundles per-demo source + README into shell/src/data/demo-content.json
  docker-compose.local.yml      # one service per package; ports from local-ports.json; env from .env
  .env.example                  # commit template — copy to .env and fill in
```

## Generated data files

The shell apps consume JSON data files that are **generated at build time** by
scripts in `scripts/`. These files are gitignored — every build path (Docker,
CI, `npm run build`, `npm run dev`) regenerates them automatically.

| File                   | Generator                   | Shell apps                                     | What it does                                                                                                              |
| ---------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `registry.json`        | `generate-registry.ts`      | shell, shell-docs, shell-dojo, shell-dashboard | Integration manifest — scans `packages/*/manifest.yaml`, builds the full catalog with metadata, feature flags, categories |
| `demo-content.json`    | `bundle-demo-content.ts`    | shell, shell-docs, shell-dojo                  | Bundled source code from every demo directory — powers the Code tab, Snippet components, dojo cell viewer                 |
| `constraints.json`     | `generate-registry.ts`      | shell                                          | Filter facets for the integration explorer (categories, frameworks, features)                                             |
| `search-index.json`    | `generate-search-index.ts`  | shell, shell-docs                              | Cmd-K search entries — scans MDX docs, AG-UI content, and registry data                                                   |
| `starter-content.json` | `bundle-starter-content.ts` | shell                                          | Starter template source bundles for the "Get Started" code viewer                                                         |
| `docs-status.json`     | `probe-docs.ts`             | shell-dashboard                                | Per-feature docs reachability — HTTP HEAD on og_docs_url, file-exists check on shell-docs MDX                             |

Each generator writes to the `src/data/` directory of every shell app that
consumes it. Shell apps are independent — no shell cross-imports another
shell's data directory.

If you add a new shell app that needs registry or demo data, add its output
path to the relevant generator script in `scripts/`.

## Prerequisites

- macOS or Linux
- [Homebrew](https://brew.sh/)
- Docker engine. Any of: Docker Desktop, **Colima** (recommended, no GUI / no sign-in), or OrbStack.
- Node 22+ and npm (for `shell` / `shell-dashboard` dev servers — they're not in the compose)

### Colima install (one time)

```sh
brew install colima docker docker-buildx docker-compose

# Tell the docker CLI where its plugins live
mkdir -p ~/.docker
cat > ~/.docker/config.json <<'JSON'
{
  "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]
}
JSON

# Start the engine (adjust resources to taste; needed for building 17 images)
colima start --cpu 4 --memory 8 --disk 60

# Verify
docker compose version
```

Colima auto-starts with `brew services start colima` if you want it on login.

## API keys

One `.env` file feeds every container. **Not committed.**

```sh
cp showcase/.env.example showcase/.env
# Edit showcase/.env and fill in:
#   OPENAI_API_KEY=<required>
#   ANTHROPIC_API_KEY=<optional; needed for Claude Agent SDK demos and a few others>
#   LANGSMITH_API_KEY=<optional; enables LangSmith tracing for LangGraph demos>
```

Only `OPENAI_API_KEY` is strictly required. Missing optional keys fail gracefully (per-package).

## Local Docker workflow

`scripts/dev-local.sh` wraps `docker compose` and handles the `shared_python/` / `shared_typescript/` staging step that CI also performs.

```sh
# from the repo root

# inspect — no Docker calls
./showcase/scripts/dev-local.sh ports            # slug → host port
./showcase/scripts/dev-local.sh ps               # what's running

# build one (first build: 1–3 min; subsequent builds are cached)
./showcase/scripts/dev-local.sh build langgraph-python

# start one — rebuilds if source changed
./showcase/scripts/dev-local.sh up langgraph-python

# start everything (17 containers, heavy)
./showcase/scripts/dev-local.sh up

# follow logs
./showcase/scripts/dev-local.sh logs langgraph-python

# stop
./showcase/scripts/dev-local.sh down langgraph-python
./showcase/scripts/dev-local.sh down            # all
```

Each container exposes port `10000` internally and is mapped to the host port in [`shared/local-ports.json`](shared/local-ports.json) (langgraph-python → 3100, langgraph-typescript → 3101, …). The image and entrypoint are **the same ones Railway runs** — no frontend-only shortcuts, no behavioral drift.

## Hooking the local containers into the shell

The `shell` app's `/preview` route iframes `integration.backend_url` (Railway) by default. Set `SHOWCASE_LOCAL=1` when running `shell` to swap in the localhost ports from `local-ports.json` instead — per-slug, falling back to Railway for anything you don't have running.

```sh
cd showcase/shell
npm install                     # once
SHOWCASE_LOCAL=1 npm run dev    # now /preview iframes http://localhost:<port>/demos/...
```

In production the env var is unset → Railway URLs, unchanged.

## shell-dashboard — feature × integration matrix

Internal overview of which packages support which features, linking to the canonical `/preview` and `/code` routes on `shell`. Lives at http://localhost:3002 and reads the same `registry.json` `shell` does.

```sh
cd showcase/shell-dashboard
npm install
npm run dev
```

Column ordering lives in `shell-dashboard/src/lib/sort-order.ts` — internal to this app, not part of the public registry.

## Iterating on a demo

1. Edit the demo in `packages/<slug>/src/app/demos/<demo-id>/page.tsx` (and the backend under `src/agents/` if applicable).
2. Rebundle so `/code` in `shell` reflects the edit: `cd showcase && npx tsx scripts/bundle-demo-content.ts`.
3. If you changed `manifest.yaml` or added a feature to `shared/feature-registry.json`: `npx tsx scripts/generate-registry.ts`.
4. Rebuild + restart the container: `./scripts/dev-local.sh up <slug>`.
5. The grid in `shell-dashboard` and `/preview` in `shell` now show the new state.

## Relationship to Railway

- Dockerfile, `entrypoint.sh`, and build context (`shared_python/`, `shared_typescript/`) are shared between local and Railway.
- `.github/workflows/showcase_deploy.yml` builds each image on push to `main` and pushes it to Railway. Per-PR deploys are opt-in via `gh workflow run showcase_deploy.yml -r <branch> -f service=<slug>`.
- The only real differences at runtime are env var values and the URL. If something works locally in Docker, it works on Railway (and vice versa).

## Updating the Dashboard

The dashboard at [showcase.copilotkit.ai](https://showcase.copilotkit.ai) reads two data sources:

1. **Static `catalog.json`** — generated at build time by `pnpm generate-registry`. Contains the full 38-feature x 17-integration cell matrix with status (`wired` / `stub` / `unshipped`), parity tiers, and feature categories. Changes require a generator run + commit.
2. **Live PocketBase probe results** — streamed via SSE. Probes discover demo routes automatically and update the dashboard in real time. No manual intervention needed for probe data.

Key invariants:

- **Parity tiers are never manually set.** They are computed by comparing each integration's wired feature set against the reference integration's.
- **The reference integration is auto-detected** as the integration with the most wired features (ties broken alphabetically). No `reference: true` flag exists.
- **`catalog.json` is gitignored** — the generator emits it into the shell apps' `src/data/` directories, which are already in `.gitignore`.
- **The `stub` status** means: feature declared in manifest, demo entry exists, but no `route` field. Today only `langgraph-python/cli-start` qualifies.

### SOP 1: Wire a new demo on an existing integration

1. Edit `showcase/packages/<slug>/manifest.yaml` — add the feature to `features[]` and a corresponding `demos[]` entry with a `route`.
2. Run `pnpm generate-registry` — updates `registry.json` AND `catalog.json`. The cell flips from `unshipped` to `wired`. Parity tiers auto-recompute.
3. Commit the manifest + both generated files. PR, merge.
4. CI rebuilds the package image + dashboard image. Railway auto-deploys both.
5. Ops probes discover the new demo route and begin probing. Dashboard updates live via PocketBase SSE — no further action needed.

### SOP 2: Code fix on an existing demo (no manifest change)

1. Edit code under `showcase/packages/<slug>/src/...`.
2. PR, merge. No generator run needed (manifest unchanged).
3. CI rebuilds the package image. Railway auto-deploys.
4. Probes re-probe on the next tick. If the fix turns a red cell green, the dashboard updates live. Zero manual steps beyond the normal PR workflow.

### SOP 3: Add a brand-new integration

1. Create `showcase/packages/<new-slug>/manifest.yaml` with `features[]` + `demos[]`.
2. Add `{"slug": "<new-slug>", "name": "<Display Name>"}` to `showcase/shared/packages.json`.
3. Provision a Railway service (manual: `railway service create` or Dashboard UI).
4. Run `pnpm generate-registry` — catalog gains 38 new cells (mostly `unshipped`, some `wired`). Parity tier computed automatically.
5. Commit, PR, merge. CI + Railway deploy. Probes discover the new service automatically via the Railway discovery filter.

### SOP 4: Reference migration (move the reference integration)

1. No manual flag needed — the generator auto-detects the reference as the integration with the most wired features (ties broken alphabetically).
2. If you want a _different_ integration to be reference, wire more features on it until it leads the count.
3. Run `pnpm generate-registry` — all parity tiers recompute automatically.
4. Commit, PR, merge.
