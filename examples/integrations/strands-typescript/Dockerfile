# Stage 1: Build Next.js frontend
FROM node:22-alpine AS frontend

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json postcss.config.mjs ./

RUN npm run build

# Stage 2: Production image with Node (agent + frontend)
FROM node:22-alpine AS runner

WORKDIR /app

# Install agent dependencies
COPY agent/ ./agent/
RUN cd agent && npm install --production

# Copy Next.js build output and production node_modules
COPY --from=frontend /app/.next ./.next
COPY --from=frontend /app/node_modules ./node_modules
COPY --from=frontend /app/package.json ./
COPY --from=frontend /app/public ./public

# Copy entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]
