# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
RUN npm run build

# Stage 2: Build AG-UI Java SDK from source + Java agent
FROM maven:3-eclipse-temurin-21 AS java-builder

# AG-UI community artifacts aren't on Maven Central yet — build from source
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
ENV GIT_LFS_SKIP_SMUDGE=1
RUN git clone --depth 1 https://github.com/ag-ui-protocol/ag-ui.git /ag-ui && \
    cd /ag-ui/sdks/community/java && \
    mvn install \
        -pl servers/spring,integrations/spring-ai -am \
        -DskipTests -Dgpg.skip=true \
        -Dmaven.javadoc.skip=true -Djavadoc.skip=true \
        -Dmaven.source.skip=true -Dcheckstyle.skip=true \
        -Dmaven.site.skip=true -Dreporting.skip=true \
        -Dassembly.skipAssembly=true \
        -B

WORKDIR /agent
COPY agent/ ./
RUN mvn -B package -DskipTests

# Stage 3: Production image with Node.js + Java
FROM eclipse-temurin:21-jre AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create unprivileged runtime user BEFORE any COPY so --chown resolves
# by name and so recursive chown over /app is never needed (fast builds).
RUN (groupadd --system --gid 1001 app 2>/dev/null || true) \
 && (useradd --system --uid 1001 --gid 1001 --no-create-home app 2>/dev/null || true) \
 && mkdir -p /home/app && chown app:app /home/app

# Next.js build artifacts
COPY --chown=app:app --from=frontend /app/.next ./.next
COPY --chown=app:app --from=frontend /app/node_modules ./node_modules
COPY --chown=app:app --from=frontend /app/package.json ./

# Java agent
COPY --chown=app:app --from=java-builder /agent/target/*.jar ./agent/app.jar

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
# NODE_ENV=production at the image level would leak into every child process
# (Java agent via `java -jar`, any mvn-launched subprocess, shell scripts,
# healthchecks) — most of which don't interpret NODE_ENV the way Next.js
# does. entrypoint.sh scopes NODE_ENV=production to the Next.js invocation
# only so non-Next children see the host's environment.
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
