# Stage 1: Build AG-UI Java SDK + Spring Boot agent backend
# Align on Temurin 21 (tracks the starter Dockerfile) — matches the
# spring-ai community artifacts + SDK source in ag-ui-protocol/ag-ui.
FROM maven:3-eclipse-temurin-21 AS java-builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# AG-UI community artifacts aren't on Maven Central yet — build from source
WORKDIR /build
COPY pom.xml ./
# Single source of truth for the AG-UI commit (shared with the
# `.github/workflows/test_unit-spring-ai.yml` workflow). Bump by editing
# the file; both CI and this image rebuild against the new SHA.
COPY .ag-ui-sha /tmp/.ag-ui-sha
ENV GIT_LFS_SKIP_SMUDGE=1
RUN AG_UI_SHA="$(tr -d '[:space:]' < /tmp/.ag-ui-sha)" && \
    if [ -z "${AG_UI_SHA}" ]; then echo "ERROR: .ag-ui-sha is empty" >&2; exit 1; fi && \
    git clone --no-checkout https://github.com/ag-ui-protocol/ag-ui.git /ag-ui && \
    # `git clone` only fetches the default branch by default — if AG_UI_SHA
    # points at a commit on a PR branch or older history not reachable from
    # HEAD, the subsequent `checkout` fails with a cryptic "reference is not
    # a tree". Explicitly fetch the SHA first so checkout is always against
    # a known-local commit (R7-A2). `--depth 1` keeps the image lean.
    git -C /ag-ui fetch --depth 1 origin "${AG_UI_SHA}" && \
    git -C /ag-ui checkout "${AG_UI_SHA}" && \
    cd /ag-ui/sdks/community/java && \
    mvn install \
        -pl servers/spring,integrations/spring-ai -am \
        -DskipTests -Dgpg.skip=true \
        -Dmaven.javadoc.skip=true -Djavadoc.skip=true \
        -Dmaven.source.skip=true -Dcheckstyle.skip=true \
        -Dmaven.site.skip=true -Dreporting.skip=true \
        -Dassembly.skipAssembly=true \
        -B && \
    cd /build && \
    mvn dependency:go-offline -B

COPY src/main/java/ src/main/java/
COPY src/main/resources/ src/main/resources/
RUN mvn package -DskipTests -B

# Stage 2: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY next.config.ts tsconfig.json postcss.config.mjs manifest.yaml ./
COPY src/app/ src/app/
COPY src/components/ src/components/
COPY src/lib/ src/lib/
COPY public/ public/
RUN npm run build

# Stage 3: Production runtime (JRE + Node, no JDK, no Maven)
FROM eclipse-temurin:21-jre AS runner

# Install Node.js 22 runtime (for Next.js). No build tools.
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Spring Boot fat JAR (from java-builder, not the full Maven workspace)
COPY --chown=app:app --from=java-builder /build/target/agent.jar ./agent.jar

# Next.js build artifacts (from frontend stage — no npm install at runtime)
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./
COPY --chown=app:app --from=frontend /app/public ./public

# Entrypoint
COPY --chown=app:app entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Ensure WORKDIR itself is owned by `app` — `WORKDIR /app` at the top of the
# stage creates /app as root, and `COPY --chown=app:app` only reassigns the
# copied files, NOT the parent dir. Without this, any subprocess that tries
# to mkdir under /app at runtime (Next.js build caches, JVM tmp, etc.) hits
# EACCES under the unprivileged user and crashes the container.
RUN chown app:app /app
USER app

EXPOSE 10000
# Intentionally NOT setting `ENV NODE_ENV=production` at the image level.
# NODE_ENV=production at the image level would leak into the Java agent and
# any shell subprocesses. entrypoint.sh scopes NODE_ENV=production to the
# Next.js invocation only (see `env NODE_ENV=production npx next start`).
ENV PORT=10000
CMD ["./entrypoint.sh"]
