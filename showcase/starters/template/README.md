# Starter Template — Docker Conventions

This directory holds the canonical starter template. The four Dockerfiles under
`dockerfiles/` (`Dockerfile.typescript`, `Dockerfile.python`, `Dockerfile.java`,
`Dockerfile.dotnet`) are the single source of truth for all 17 starter images;
per-slug Dockerfiles at `showcase/starters/<slug>/Dockerfile` are emitted
deterministically by `showcase/scripts/generate-starters.ts`.

## Multi-Stage Build Convention

Every template (and every regenerated per-slug Dockerfile) is a true
multi-stage build:

- **Builder stage** carries the full language toolchain — `node:24`,
  `python:3.12`, `eclipse-temurin:21-jdk`, `dotnet-sdk:9.0` — and produces
  compiled/bundled artifacts (`.next`, a populated `/opt/venv`, a shaded
  jar, a `dotnet publish` output). Dev dependencies, package managers,
  and build tools live here and here only.
- **Runtime stage** starts from a minimal base — `node:24-slim`,
  `python:3.12-slim`, `eclipse-temurin:21-jre-alpine`,
  `mcr.microsoft.com/dotnet/aspnet:9.0` — and ships **only** the compiled
  artifacts. No `pip install`, `pnpm install`, `tsx`, or `*-cli dev` runs
  at container start. Cold start is a straight `node` / `python` / `java`
  / `dotnet` invocation.

## Size Target

Multi-stage splits are expected to produce **≥40% runtime image-size
reduction** versus a single-stage equivalent. This is measured per slug
against the pre-multi-stage baseline captured in the body-of-work PR and
is enforced downstream by regeneration smoke checks.

## Platform Pin (local builds)

All local `docker build` invocations for showcase images MUST pass
`--platform linux/amd64`. Railway and GHCR serve x86 hosts; an arm64-only
image built on Apple Silicon will crash on pull with
`does not have a linux/amd64 variant available`. CI pins the same platform
on the deploy workflow.

Example:

```bash
docker build \
  --platform linux/amd64 \
  -f showcase/starters/langgraph-python/Dockerfile \
  -t starter-smoke:langgraph-python \
  showcase/starters/langgraph-python
```

## Hygiene Probe

The `dockerfile_hygiene` probe (invoked from `showcase/scripts/*` and the
template-drift workflow) enforces the convention mechanically:

- Each Dockerfile under `showcase/starters/*/` and `showcase/packages/*/`
  must contain **≥2 `FROM` stages** (builder + runtime).
- The **runtime stage** must contain no dev-dep install commands —
  `pip install`, `npm install`, `pnpm install`, `tsx`, `*-cli dev`, and
  equivalents are all disallowed after the final `FROM` line.

Violations fail the probe and block the PR.

## Editing

- Edit the templates under `dockerfiles/`, not the per-slug outputs.
- Run `pnpm -C showcase exec tsx scripts/generate-starters.ts` to
  regenerate all 17 starters.
- Commit the template change and the regenerated Dockerfiles together.
