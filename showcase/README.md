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
