# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Enable corepack for pnpm support
RUN corepack enable

# Copy package files. .npmrc must come with them: it carries
# legacy-peer-deps=true, without which `npm install` fails here with ERESOLVE
# (@ag-ui/mastra's "@copilotkit/runtime": "^1.10.5" peer cannot match the
# prerelease pin, because semver excludes prereleases from a caret range).
# Copying it later, with the rest of the source, would be too late.
COPY package.json .npmrc ./

# Install dependencies (no lockfile in this starter)
RUN npm install

# Copy source code
COPY . .

# Build the Next.js application
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
