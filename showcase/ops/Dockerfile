FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY showcase/ops/package.json ./showcase/ops/package.json
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
# don't rely on postinstall scripts in showcase-ops.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @copilotkit/showcase-ops...

COPY showcase/ops ./showcase/ops

RUN pnpm --filter @copilotkit/showcase-ops build

# `pnpm deploy` materializes a standalone, hoisted node_modules with only
# production deps into /deploy — no symlinks into /repo/node_modules/.pnpm.
# Without this, the runtime stage would copy a pnpm-hoisted tree whose
# symlinks point into paths that don't exist in the final image.
# `--legacy` keeps pnpm v10+'s `deploy` usable without requiring
# `inject-workspace-packages=true` across the repo — we don't use
# injected workspace deps in showcase-ops.
# Verified on pnpm 10.13.x — the `--legacy` flag semantics shifted in the
# 10.x line (pre-10.x `deploy` was itself the legacy behavior and the flag
# was a no-op). Pin the comment to the repo's committed pnpm version so
# future upgrades surface the dependency.
RUN pnpm --filter @copilotkit/showcase-ops --prod --legacy --ignore-scripts deploy /deploy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/showcase/ops/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/showcase/ops/config ./config
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
# chown /app to node so the runtime user can write scratch files under
# /app if ever needed. Orchestrator today writes only to mounted volumes
# (PB data dir, S3 backup buffer), so this is defensive hygiene — running
# as node with a root-owned /app would silently break any future feature
# that wants to write a pid/lock file next to the binary.
RUN chown -R node:node /app
USER node
EXPOSE 8080
# Runtime healthcheck. Railway provides its own health check on the
# `health_path` in ALL_SERVICES, so this is primarily for parity with
# `docker run` locally (and CI integration harnesses that use
# `docker inspect` to gate test starts on container health). 30s
# start-period gives Node + config-load time before the first probe.
#
# BUSYBOX WGET BEHAVIOR: a 503 at /health (intentional response from
# orchestrator.ts when the rule-loader / probe pipeline is in a broken
# state) causes busybox `wget -q --spider` to exit 1, which Docker /
# Railway read as "unhealthy" and restart the container after 3 retries.
# That restart loop is THE INTENDED OUTCOME during sustained-503
# windows: if /health is reporting broken for 90s straight, restarting
# the orchestrator is the right remediation (faster than waiting for a
# human to notice). Do not "soften" this by treating 503 as healthy —
# the 503 is specifically how orchestrator.ts communicates "I cannot
# serve" to its supervisor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/orchestrator.js"]
