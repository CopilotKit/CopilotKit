# Unified showcase frontend — ONE Next.js app that serves EVERY integration's
# demos at /<integration-slug>/demos/<demo-id>.
#
# BUILD CONTEXT IS THE REPOSITORY ROOT. showcase/docker-compose.local.yml sets
# `context: ../` + `dockerfile: showcase/frontends/nextjs/Dockerfile`, so every
# source path below is repo-relative, not app-relative. The root context is
# required (not incidental): the `manifests` stage reaches
# showcase/integrations/*/manifest.yaml, which lives outside this app directory.
#
# Build it by hand from the repository root with:
#   docker build -f showcase/frontends/nextjs/Dockerfile -t showcase-frontend-nextjs:local .
#
# Stages are referenced BY THEIR `AS` NAME below (`builder`, `manifests`,
# `runner`), never by an ordinal. An earlier revision numbered them 1/2/3 and
# then deleted the middle one, leaving two cross-references pointing at a
# "stage 2" that no longer existed. Names cannot rot that way.

###############################################################################
# Stage `builder`: install dependencies and build the Next.js app.
###############################################################################
FROM node:22-slim AS builder
WORKDIR /app

# Package manifests + .npmrc FIRST so the slow install layer caches
# independently of the app source.
#
# `--legacy-peer-deps` matches all 20 integration Dockerfiles and the app's own
# .npmrc (`legacy-peer-deps=true`): openai@5.x declares `peerOptional zod@^3`
# while @tanstack/ai-openai hard-requires zod@^4, so a strict peer resolution
# fails. The flag is passed explicitly AND shipped in .npmrc so a plain
# `npm ci` on a developer machine behaves identically to this image build.
COPY showcase/frontends/nextjs/package.json \
     showcase/frontends/nextjs/package-lock.json \
     showcase/frontends/nextjs/.npmrc \
     ./
RUN npm ci --legacy-peer-deps

# App source. The repo-root .dockerignore already strips node_modules / .next /
# .git / caches from the context, so this does not overwrite the installed tree.
COPY showcase/frontends/nextjs/ ./
RUN npm run build

# A `prod-deps` stage running `npm ci --omit=dev` was built, measured and
# REMOVED. Do not re-add it without measuring first.
#
# The theory was that dropping devDependencies would roughly halve the image.
# Measured on the real tree, it saved NOTHING. Two images were compared, one
# built with the stage and one without: node_modules was byte-for-byte the same
# size and package count in both (1.5 GB, 569 packages, 37 .bin entries).
# The weight is all runtime dependencies:
#
#     @next 273M · next 158M · @copilotkit 85M · mermaid 84M
#     @tanstack 54M · streamdown 44M · lucide-react 40M · react-aria 39M
#
# vitest and playwright are rounding errors against that. The stage cost a
# second full `npm ci` on every build and forced a workaround: `--omit=dev`
# drops `typescript`, which `next start` needs at RUNTIME to load
# next.config.ts, and without it Next shells out to `yarn add typescript`
# during boot — needing network at runtime and writing into node_modules, which
# USER app cannot do. Boot then proceeds with next.config.ts UNREAD, so
# `serverExternalPackages: ["@copilotkit/runtime"]` never applies and
# built-in-agent's in-process runtime breaks (see the next.config.ts COPY in the
# `runner` stage).
#
# WHERE THE SIZE ACTUALLY IS, as of porting all 43 demos:
#
#     node_modules  1.5G
#     .next         966M   <- was 55M before the demos landed
#
# Total ~2.4 GB. `.next` grew by ~900M purely from adding the demo pages, so it
# is now a first-class term, not a rounding error. If this image's size needs to
# come down, the lever is Next's `output: "standalone"` in next.config.ts: it
# emits a minimal server AND prunes the runtime tree, addressing both terms at
# once. That is a real change with a real payoff, unlike omitting
# devDependencies. Measure before and after, as was done here — the intuitive
# answer was wrong.

###############################################################################
# Stage `manifests`: stage the integration manifests — and ONLY the manifests.
#
# WHY THIS STAGE EXISTS. `src/lib/integration-support.ts` reads the manifests
# FROM DISK AT RUNTIME: `readManifests()` calls `resolveIntegrationsDir()`
# (that direction — the resolver is the callee). Neither function has a lenient
# path. If no directory resolves, `resolveIntegrationsDir()` THROWS
# `ManifestLoadError`; if a directory resolves but yields no manifest,
# `readManifests()` throws again ("A deployment with zero integrations is never
# valid"). Nothing ever returns an empty list.
#
# So a missing manifest tree fails LOUDLY at request time, naming the env var
# and the candidate paths it tried. What it does NOT do is fail at BUILD time:
# the image still builds green, and the breakage only appears once a container
# serves its first request. That is exactly why the manifests must be baked in
# here, and why the build-time `test` guard below is worth its line.
# The manifests are the only thing this app needs from outside its own
# directory.
#
# WHY A BIND MOUNT INSTEAD OF `COPY`. The layout the app expects is
# `<dir>/<slug>/manifest.yaml`, one directory per integration. A plain
# `COPY showcase/integrations/*/manifest.yaml ./integrations/` FLATTENS the
# matches — all 20 files land on the same basename and clobber each other —
# and `COPY --parents` needs the labs Dockerfile frontend, which nothing else
# in this repo pulls. Copying the whole `showcase/integrations/` tree instead
# would drag ~8,000 files and every agent's source into a frontend image.
#
# A `RUN --mount=type=bind` reads the tree without persisting it in any layer;
# only the ~20 small YAML files written to /manifests survive into the export.
# It is also generic: a new integration is picked up with no edit here.
###############################################################################
FROM node:22-slim AS manifests
RUN mkdir -p /manifests
# `cp --parents` recreates the `<slug>/` directory for each match, which is the
# exact shape `readManifests()` walks (it skips entries starting with `_`, so
# `_shared` is harmless either way — it has no manifest.yaml).
# The final `test` is a fail-loud guard, but be precise about what it can and
# cannot catch:
#   • NOT a moved source path — that fails EARLIER and harder, at the
#     `--mount=type=bind,source=showcase/integrations` line, which cannot mount
#     a path that does not exist in the build context.
#   • It DOES catch a rename of `manifest.yaml`, or a depth change in the
#     integrations layout (the `find` is pinned to exactly depth 2), either of
#     which would silently copy nothing.
#   • A bare `-gt 0` would NOT catch a PARTIAL stage: 3 manifests out of 20
#     passes it just as well as 20. Hence the floor below plus the printed
#     count — the floor trips on a badly partial copy, and the echoed count is
#     the thing a human reads in the build log to notice a mildly partial one.
# MANIFEST_FLOOR is deliberately well under the current roster (20) so removing
# an integration never breaks the build; it exists to catch collapse, not to pin
# the roster. The guard is `-ge`, so if the roster ever shrinks toward the floor,
# LOWER the floor — raising it is what would red the build on a legitimate
# removal, i.e. exactly the failure this floor is set low to avoid.
RUN --mount=type=bind,source=showcase/integrations,target=/src \
    cd /src \
 && find . -mindepth 2 -maxdepth 2 -name manifest.yaml -exec cp --parents {} /manifests/ \; \
 && MANIFEST_COUNT="$(find /manifests -name manifest.yaml | wc -l)" \
 && MANIFEST_FLOOR=10 \
 && echo "[manifests] staged ${MANIFEST_COUNT} integration manifests (floor ${MANIFEST_FLOOR}):" \
 && find /manifests -name manifest.yaml -printf '[manifests]   %P\n' | sort \
 && test "$MANIFEST_COUNT" -ge "$MANIFEST_FLOOR"

###############################################################################
# Stage `runner`: slim runtime image. No build toolchain, no source tree.
###############################################################################
FROM node:22-slim AS runner
WORKDIR /app

# Create the unprivileged runtime user BEFORE any COPY so `--chown=app:app`
# resolves by NAME and no recursive chown over /app is ever needed (recursive
# chown on a Next.js node_modules tree is minutes of build time). Same pattern
# and same reasoning as every showcase integration Dockerfile — Railway, and
# any platform that enforces non-root by policy, needs it.
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app \
 && chown app:app /app

# Next.js build artifacts and the full installed tree.
#
# The tree is copied WHOLE, including devDependencies. That is deliberate — see
# the measurement above the manifests stage. It also keeps `typescript` present,
# which `next start` needs at RUNTIME to load next.config.ts: without it Next
# logs "Installing TypeScript as it was not found" and shells out to
# `yarn add typescript` during boot, which needs network at runtime and writes
# into node_modules (impossible as USER app). Boot then continues with
# next.config.ts UNREAD, so `serverExternalPackages` is not applied and
# built-in-agent's in-process runtime breaks — while the container still reports
# healthy.
COPY --chown=app:app --from=builder /app/.next ./.next
COPY --chown=app:app --from=builder /app/node_modules ./node_modules
COPY --chown=app:app --from=builder /app/package.json ./
COPY --chown=app:app --from=builder /app/public ./public
# next.config.ts is read by `next start`, not only by `next build`, and this COPY
# is REQUIRED — do not delete it.
#
# The reason is `serverExternalPackages: ["@copilotkit/runtime"]`. built-in-agent
# is the one integration whose agent runs IN-PROCESS inside this app, so
# @copilotkit/runtime executes server-side here; if the config is not loaded at
# runtime the package gets bundled and that integration breaks.
#
# The file's `X-Frame-Options: ALLOWALL` / `frame-ancestors *` headers are NOT
# the reason: `ALLOWALL` is not a valid X-Frame-Options value (browsers ignore
# it) and `frame-ancestors *` is the permissive default, so the pages embed fine
# with neither header. They are useful only as intent documentation and as the
# cheapest runtime PROOF that next.config.ts was loaded at all: if `curl -I`
# against a running container shows them, the config was read, which is what
# serverExternalPackages depends on.
COPY --chown=app:app --from=builder /app/next.config.ts ./

# The integration manifests (see the `manifests` stage).
# SHOWCASE_INTEGRATIONS_DIR is the FIRST candidate `resolveIntegrationsDir()`
# tries, so this pins resolution explicitly instead of depending on the process
# CWD.
COPY --chown=app:app --from=manifests /manifests ./integrations
ENV SHOWCASE_INTEGRATIONS_DIR=/app/integrations

USER app

EXPOSE 3000
ENV PORT=3000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# At image level it leaks into every child process (shell scripts, health
# checks, any tooling exec'd into the container), most of which do not use it
# the way Next.js does. Scope it to the Next.js invocation only, exactly as the
# integration entrypoints do.
CMD ["sh", "-c", "NODE_ENV=production exec ./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
