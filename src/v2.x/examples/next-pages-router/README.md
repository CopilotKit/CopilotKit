# CopilotKit v2 Client Example

This is a minimal Next.js client that connects to the v2 Express runtime.

## Setup

```bash
pnpm -C ../../ install
```

Create a local env file:

```bash
cp .env.example .env.local
```

Optionally edit `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL` in `.env.local`.

## Run

```bash
pnpm -C ../../ --filter next-pages-router example-dev
```

Then open:

```
http://localhost:3000
```

## Build

```bash
pnpm -C ../../ --filter next-pages-router example-build
```

## Notes

- This example uses the Next.js App Router (`app/` directory).
- The client sets `useSingleEndpoint` to match the Express runtime.
