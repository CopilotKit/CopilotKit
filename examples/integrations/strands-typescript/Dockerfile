# Stage 1: Build Next.js frontend
FROM node:22-alpine AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs showcase.json ./

RUN npm run build

# Stage 2: Production image with Node (agent + frontend)
FROM node:22-alpine AS runner

RUN apk add --no-cache bash

WORKDIR /app

# Install agent dependencies (tsx is a production dep)
COPY agent/ ./agent/
RUN cd agent && npm install --ignore-scripts

# Copy Next.js standalone build output
COPY --from=frontend /app/.next/standalone ./
COPY --from=frontend /app/.next/static ./.next/static
COPY --from=frontend /app/public ./public

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
