# CopilotKit v2 Express Example (Single Route)

This example hosts a CopilotKit v2 runtime using Express and the single-route helper.

## Setup

```bash
pnpm -C ../../ install
```

Create a local env file:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

## Run

```bash
pnpm -C ../../ --filter node-express example-dev
```

The runtime will be available at:

```
http://localhost:4000/api/copilotkit
```

## Build

```bash
pnpm -C ../../ --filter node-express example-build
```

## Notes

- This example uses `createCopilotEndpointSingleRouteExpress`.
- TypeScript uses `moduleResolution: node16` to resolve the `@copilotkitnext/runtime/express` export correctly.
