# LangGraph agent (TypeScript) — runs the langgraph dev server on port 8123.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY langgraph.json ./
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm ci

RUN chown -R node:node /app

EXPOSE 8123

USER node

CMD ["npx", "@langchain/langgraph-cli@1.2.1", "dev", "--host", "0.0.0.0", "--port", "8123", "--no-browser"]
