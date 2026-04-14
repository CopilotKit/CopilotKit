# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY next.config.ts tsconfig.json postcss.config.mjs ./
RUN npm run build

# Stage 2: Build Java agent
FROM maven:3-eclipse-temurin-21 AS java-builder
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

# Next.js build artifacts
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./

# Java agent
COPY --from=java-builder /agent/target/*.jar ./agent/app.jar

# Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid 1001 --no-create-home app
USER app

EXPOSE 10000
ENV NODE_ENV=production
ENV PORT=10000
ENV HOSTNAME=0.0.0.0
CMD ["./entrypoint.sh"]
