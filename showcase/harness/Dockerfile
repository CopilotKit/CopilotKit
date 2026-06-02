FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY showcase/harness/package.json ./showcase/harness/package.json
# Copy every workspace package.json manifest (but NOT source / node_modules).
# The version-drift probe's pnpm-packages discovery source parses these at
# runtime. Doing this in the build stage (rather than COPY-ing packages/
# directly into the runtime image from the host build context) keeps the
# runtime stage hermetic and consistent — the final image is always
# assembled strictly from build-stage artifacts.
COPY packages ./packages-src-tmp
RUN mkdir -p ./packages && \
    cd packages-src-tmp && \
    find . -maxdepth 2 -name package.json -not -path '*/node_modules/*' | \
    while read f; do \
      dir="../packages/$(dirname "$f")"; \
      mkdir -p "$dir" && cp "$f" "$dir/package.json"; \
    done && \
    cd .. && rm -rf packages-src-tmp

# `--ignore-scripts` skips the root `prepare` hook (lefthook install), which
# requires `git` and is meaningless inside the build image. Deps themselves
# don't rely on postinstall scripts in showcase-harness.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @copilotkit/showcase-harness...

COPY showcase/harness ./showcase/harness
# e2e-smoke probe: generate registry.json at build time (the file is
# gitignored, so it won't exist in a clean checkout). Copy the scripts
# directory plus shared/packages metadata the generator reads, install
# script deps, and run the generator. The runtime stage copies the
# resulting file via `COPY --from=build`.
COPY showcase/shared/ ./showcase/shared/
COPY showcase/integrations/ ./showcase/integrations/
COPY showcase/scripts/package.json showcase/scripts/package-lock.json ./showcase/scripts/
COPY showcase/scripts/ ./showcase/scripts/
RUN cd showcase/scripts && npm ci --silent \
    && node node_modules/tsx/dist/cli.mjs generate-registry.ts

RUN pnpm --filter @copilotkit/showcase-harness build

# `pnpm deploy` materializes a standalone, hoisted node_modules with only
# production deps into /deploy — no symlinks into /repo/node_modules/.pnpm.
# Without this, the runtime stage would copy a pnpm-hoisted tree whose
# symlinks point into paths that don't exist in the final image.
# `--legacy` keeps pnpm v10+'s `deploy` usable without requiring
# `inject-workspace-packages=true` across the repo — we don't use
# injected workspace deps in showcase-harness.
# Verified on pnpm 10.13.x — the `--legacy` flag semantics shifted in the
# 10.x line (pre-10.x `deploy` was itself the legacy behavior and the flag
# was a no-op). Pin the comment to the repo's committed pnpm version so
# future upgrades surface the dependency.
RUN pnpm --filter @copilotkit/showcase-harness --prod --legacy --ignore-scripts deploy /deploy

# Runtime stage: Debian-slim (not Alpine) because the e2e-smoke probe
# driver launches chromium in-process via `playwright`. Playwright's
# `install --with-deps` only supports apt-based distros — Alpine ships
# musl libc, and the upstream chromium binaries Playwright downloads are
# glibc-linked. Switching the runtime image to `node:22-bookworm-slim`
# lets `playwright install --with-deps chromium` succeed without a
# custom apk dance. Build stage stays Alpine (just compiles TS and
# prunes node_modules — no browser needed there).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# qa probe: repo-root override so the walk-up from dist/probes/drivers/
# (3 levels to /app) matches the showcase/integrations/ layout copied above.
ENV QA_REPO_ROOT=/app
# pin-drift probe: same walk-up issue — the compiled driver lives at
# dist/probes/drivers/pin-drift.js, five `..` segments overshoot /app
# and land at /. Override so the driver finds showcase/scripts/fail-baseline.json.
ENV PIN_DRIFT_REPO_ROOT=/app
# D6 probe (cli/config.ts loadConfig): the compiled config.js lives at
# /app/dist/cli/config.js, so its `../../..` relative walk lands at `/`, not
# `/app/showcase`. resolveIntegrationDir then looks for specs under
# `/integrations/<slug>` and never finds the suite the COPY below places at
# `/app/showcase/integrations/<slug>`, so a real in-container D6 run reports
# "No Playwright e2e suite found" → all-unknown. Pin the showcase root to the
# image's actual layout so spec resolution works.
ENV SHOWCASE_DIR=/app/showcase
# Playwright cache lives outside /home/node so `chown` below doesn't
# have to recurse over the ~300MB chromium tree on every build. Setting
# PLAYWRIGHT_BROWSERS_PATH at this stage pins the install target; the
# orchestrator reads the same env at runtime via `playwright`'s own
# default resolution logic.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /repo/showcase/harness/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/showcase/harness/config ./config
# e2e-smoke + D6 probes: install chromium + its system deps. `--with-deps`
# pulls in libnss3, libatk, libxkbcommon, libdrm, etc. via apt. Runs as
# root because apt-get needs root. Call `playwright/cli.js` directly
# (not via `npx playwright`) — pnpm's deploy output materialises a
# hoisted node_modules but doesn't always produce a `.bin/playwright`
# shim, so `npx playwright` would resolve to "not found".
RUN node ./node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
# version-drift probe: the pnpm-packages discovery source reads
# pnpm-workspace.yaml + each workspace package manifest at probe-tick time.
# Copy them into /app so the source resolves with rootDir=/app (the runtime
# WORKDIR) without any further configuration. Only manifest files are
# copied — node_modules and source trees stay out of the runtime image.
# packages/ is the only workspace prefix version-drift.yml filters to today
# (filter.pathPrefix: "packages/"); adding examples/ or sdk-python here
# would be safe — the probe's filter is the authoritative gate — but we
# keep the image lean until another probe config actually needs those trees.
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /repo/packages ./packages
# pin-drift probe: the driver reads showcase/scripts/fail-baseline.json as
# the ratchet baseline. Only the JSON file is needed — the full scripts/
# tree stays out of the runtime image.
COPY --from=build /repo/showcase/scripts/fail-baseline.json ./showcase/scripts/fail-baseline.json
# qa probe: the driver reads showcase/integrations/<slug>/manifest.yaml to
# check QA file coverage. Copy only the manifests (not full source) to
# keep the runtime image lean. The qa/ subdirectories are also needed
# since the driver file-stats qa/<featureId>.md per demo.
COPY --from=build /repo/showcase/integrations ./showcase/integrations
# D6 spec-driven toolchain contract: the D6 driver runs each integration's
# OWN Playwright suite by spawning `npx playwright test` with cwd
# /app/showcase/integrations/<slug> (see cli/e2e.ts buildE2eCommand). Those
# specs `import { test, expect } from "@playwright/test"` and Node resolves
# that by walking up from the integration dir to /app/node_modules. We ship
# the integration specs WITHOUT their own node_modules, so the SINGLE hoisted
# @playwright/test in /app/node_modules (added as a PROD dep of
# showcase-harness → materialised by `pnpm --prod deploy` above) is what both
# the runner binary AND the specs resolve. @playwright/test and playwright are
# pinned to the SAME exact 1.59.1 as the chromium build installed above, so the
# runner and the specs share one version — eliminating Playwright's
# "two different versions of @playwright/test" guard. Fail the BUILD (not a
# probe tick) if any leg of that contract is missing:
#   1. @playwright/test resolves from a sample integration dir (walk-up works).
#   2. `npx playwright` resolves to the hoisted CLI (creates the .bin shim if
#      pnpm deploy omitted it, so the unchanged `npx playwright test` runner
#      path works).
#   3. chromium is resolvable under PLAYWRIGHT_BROWSERS_PATH.
#
# CRITICAL ORDERING: this verify MUST run AFTER the
# `COPY --from=build /repo/showcase/integrations` above. The earlier
# placement (immediately after the chromium install, ~30 lines up) ran
# BEFORE the integrations were present, so the `cd
# /app/showcase/integrations/langgraph-python` failed but — because the
# `cd` was the only integration-dependent leg and the step's exit code was
# masked — the @playwright/test version contract was never actually
# exercised at build. A version/resolution break would have shipped silently
# and only surfaced as an all-unknown probe tick at runtime. Keeping it here,
# after the COPY, makes a broken contract fail the BUILD as intended.
RUN set -eux; \
    test -f /app/showcase/integrations/langgraph-python/playwright.config.ts; \
    node -e "require.resolve('@playwright/test', { paths: ['/app/showcase/integrations/langgraph-python'] })"; \
    if [ ! -e /app/node_modules/.bin/playwright ]; then \
      mkdir -p /app/node_modules/.bin; \
      ln -sf ../playwright/cli.js /app/node_modules/.bin/playwright; \
      chmod +x /app/node_modules/playwright/cli.js; \
    fi; \
    cd /app/showcase/integrations/langgraph-python && npx playwright --version; \
    node /app/node_modules/playwright/cli.js install chromium --dry-run >/dev/null
# e2e-smoke probe: the driver's default demos resolver reads
# `/app/data/registry.json` to look up each Railway service slug's demo
# list (`tool-rendering` gates the L4 tool-rendering check). The registry
# is generated at build time by `showcase/scripts/generate-registry.ts`
# (see the build stage above); we copy the result here so the runtime
# image is hermetic (no network read at probe tick time).
COPY --from=build /repo/showcase/shell/src/data/registry.json ./data/registry.json
# chown /app AND the playwright browser cache so the runtime user can
# read the chromium tree at launch. Orchestrator today writes only to
# mounted volumes (PB data dir, S3 backup buffer), so the /app chown
# is defensive hygiene — running as node with a root-owned /app would
# silently break any future feature that wants to write a pid/lock
# file next to the binary.
RUN chown -R node:node /app /ms-playwright
USER node
EXPOSE 8080
# Runtime healthcheck. Railway provides its own health check on the
# `health_path` in ALL_SERVICES, so this is primarily for parity with
# `docker run` locally (and CI integration harnesses that use
# `docker inspect` to gate test starts on container health). 30s
# start-period gives Node + config-load time before the first probe.
#
# NODE HEALTHCHECK: previously `wget -q --spider`, which was busybox-wget
# on Alpine. After the base-image move to Debian-slim (needed for
# Playwright chromium), we switched to a Node one-liner because Debian
# slim doesn't ship wget / curl by default and adding them just for
# healthcheck would bloat the image unnecessarily. Node's http module
# gives us the same semantic: non-2xx status → exit 1 → Docker/Railway
# mark unhealthy.
#
# 503 at /health (intentional response from orchestrator.ts when the
# rule-loader / probe pipeline is in a broken state) still causes the
# container to be marked unhealthy and restarted after 3 retries. That
# restart loop is THE INTENDED OUTCOME during sustained-503 windows:
# if /health is reporting broken for 90s straight, restarting the
# orchestrator is the right remediation (faster than waiting for a
# human to notice). Do not "soften" this by treating 503 as healthy —
# the 503 is specifically how orchestrator.ts communicates "I cannot
# serve" to its supervisor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8080/health',r=>process.exit(r.statusCode>=200&&r.statusCode<300?0:1)).on('error',()=>process.exit(1))" || exit 1
CMD ["node", "dist/orchestrator.js"]
