FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY showcase/ops/package.json ./showcase/ops/package.json

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
# Playwright cache lives outside /home/node so `chown` below doesn't
# have to recurse over the ~300MB chromium tree on every build. Setting
# PLAYWRIGHT_BROWSERS_PATH at this stage pins the install target; the
# orchestrator reads the same env at runtime via `playwright`'s own
# default resolution logic.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /repo/showcase/ops/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/showcase/ops/config ./config
# Install chromium + its system deps. `--with-deps` pulls in libnss3,
# libatk, libxkbcommon, libdrm, etc. via apt — sourced from the
# playwright package's postinstall-free CLI. Runs as root (we haven't
# dropped to the `node` user yet) because apt-get needs root.
#
# Call `playwright/cli.js` directly (not via `npx playwright`) — pnpm's
# deploy output materialises a hoisted node_modules but doesn't always
# produce a `.bin/playwright` shim, so `npx playwright` would resolve
# to "not found". The direct `node` invocation is also faster: no npx
# registry metadata roundtrip.
RUN node ./node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
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
