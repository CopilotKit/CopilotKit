# Stage 1: Build AG-UI Java SDK + Spring Boot agent backend
FROM eclipse-temurin:17-jdk-jammy AS java-builder
RUN apt-get update && apt-get install -y maven git && rm -rf /var/lib/apt/lists/*

# Build AG-UI Java SDK from source, then resolve our dependencies
WORKDIR /build
COPY pom.xml ./
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
        -B && \
    cd /build && \
    mvn dependency:go-offline -B

COPY src/main/java/ src/main/java/
COPY src/main/resources/ src/main/resources/
RUN mvn package -DskipTests -B

# Stage 2: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src/app/ src/app/
COPY public/ public/
RUN npm run build

# Stage 3: Production runtime (JRE + Node)
FROM eclipse-temurin:17-jre-jammy AS runner

# Install Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Spring Boot fat JAR
COPY --from=java-builder /build/target/agent.jar ./agent.jar

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 10000
ENV NODE_ENV=production
CMD ["./entrypoint.sh"]
