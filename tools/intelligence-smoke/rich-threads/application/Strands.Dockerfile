FROM node:24.18.0-slim
WORKDIR /app/src/agent
COPY src/agent/package.json src/agent/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY src/agent ./
COPY src/cvdiag ../cvdiag
COPY shared-tools /app/shared-tools
COPY rich-threads /app/rich-threads
COPY source-manifest.json /app/source-manifest.json
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000 9191
CMD ["node", "/app/rich-threads/lifecycle/railway/native-start.mjs"]
