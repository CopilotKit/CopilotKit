# Per-cell image: Spring AI × Agentic Chat (Java / Spring Boot).
#
# Three-layer source layout:
#   backend/   — Spring Boot agent (pom.xml, src/main/java/..., application.properties)
#   frontend/  — Next.js app (package.json, src/app, etc.)
#   (root)     — containerization: this Dockerfile + entrypoint.sh
#
# Stage 1 builds the AG-UI Java SDK from GitHub (once per cell) + the agent jar.
# Stage 2 builds the Next.js frontend.
# Stage 3 is the slim JRE + Node runtime that runs both side by side.

# ---------------------------------------------------------------------
# Stage 1: Build AG-UI Java SDK + Spring Boot agent backend
# ---------------------------------------------------------------------
FROM eclipse-temurin:17-jdk-jammy AS java-builder
RUN apt-get update && apt-get install -y maven git && rm -rf /var/lib/apt/lists/*

WORKDIR /build
# Install AG-UI Java SDK modules into the local Maven repo.
# This is the same source the top-level spring-ai package builds from.
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

# Our own pom + sources
COPY backend/pom.xml ./
RUN mvn dependency:go-offline -B
COPY backend/src/main/java/ src/main/java/
COPY backend/src/main/resources/ src/main/resources/
RUN mvn package -DskipTests -B

# ---------------------------------------------------------------------
# Stage 2: Build Next.js frontend
# ---------------------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /app
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------
# Stage 3: Production runtime — JRE + Node
# ---------------------------------------------------------------------
FROM eclipse-temurin:17-jre-jammy AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Spring Boot fat jar
COPY --from=java-builder /build/target/agent.jar ./agent.jar

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
CMD ["./entrypoint.sh"]
