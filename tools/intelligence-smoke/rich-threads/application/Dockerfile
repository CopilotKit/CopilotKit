FROM node:24.18.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packs ./packs
RUN npm ci --legacy-peer-deps
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000 3001 3002 9191
CMD ["node", "node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
