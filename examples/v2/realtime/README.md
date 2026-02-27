# Realtime Threads PoC (v2-only)

This example demonstrates tokenized websocket fanout with Redis-backed thread locks and replay buffers.

## Apps

- `realtime-client`: Next.js UI using `WebSocketAgent` from `@copilotkitnext/core`.
- `realtime-bff`: Express + `CopilotRuntime` + Redis token/lock endpoints.
- `realtime-gateway`: Phoenix/Elixir Channels gateway using `Phoenix.PubSub.Redis` for thread fanout.

## Run with Nx

```bash
pnpm nx run realtime-stack:dev
```

Per app:

```bash
pnpm nx run realtime-client:dev
pnpm nx run realtime-bff:dev
pnpm nx run realtime-gateway:dev
```

## Docker Compose

```bash
docker compose -f examples/v2/realtime/docker-compose.yml up --build
```

Ports:

- Client: `http://localhost:4000`
- BFF: `http://localhost:4100`
- Gateway websocket: `ws://localhost:4200/ws/websocket`
- Redis: `localhost:6379`
