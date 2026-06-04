# Framework Detection

Detect the project's framework before generating any setup code. The detection order matters -- check more specific signals first.

## Detection Decision Tree

```
1. Does `angular.json` exist?
   YES -> Angular
   NO  -> continue

2. Does `next.config.{js,ts,mjs}` exist?
   YES -> Next.js (go to step 3)
   NO  -> continue to step 4

3. Does an `app/` directory exist at the project root or under `src/`?
   YES -> Next.js App Router
   NO  -> Does a `pages/` directory exist at the project root or under `src/`?
          YES -> Next.js Pages Router
          NO  -> Next.js App Router (assume App Router for new projects)

4. Does `vite.config.{js,ts}` exist AND does `package.json` list `react` as a dependency?
   YES -> Vite + React
   NO  -> Unknown / standalone backend only
```

## What Differs Per Framework

### Next.js App Router

- **Runtime location:** `src/app/api/copilotkit/[[...slug]]/route.ts` (multi-route) or `src/app/api/copilotkit/route.ts` (single-route)
- **Provider placement:** In a `"use client"` page or layout component
- **Route handler style:** Named exports `GET` and `POST` using `handle(app)` from `hono/vercel`
- **Stylesheet import:** In `layout.tsx`: `import "@copilotkit/react/styles.css"`
- **Env file:** `.env.local`
- **Extra deps:** `hono` (for Hono adapter)

### Next.js Pages Router

- **Runtime location:** Typically runs as a separate Express server (not in API routes). The Pages Router examples in the CopilotKit repo use an external Express runtime.
- **Provider placement:** In `pages/_app.tsx` or a page component. Must be a client component (default in Pages Router).
- **Frontend connects to external URL:** `runtimeUrl` points to the Express server (e.g., `http://localhost:4000/api/copilotkit`)
- **Stylesheet import:** In `pages/_app.tsx` or `styles/globals.css`: `import "@copilotkit/react/styles.css"`
- **Env file:** `.env.local`
- **Key prop:** `useSingleEndpoint` must be set on the provider when using single-route Express endpoints

### Angular

- **Runtime location:** Separate backend server (Express or Hono standalone)
- **Provider placement:** Uses Angular-specific components from `@copilotkit/angular` (separate package)
- **Not React-based:** Does NOT use `CopilotKitProvider` or React hooks
- **Stylesheet import:** Via Angular styles configuration in `angular.json`
- **Package:** `@copilotkit/angular` instead of `@copilotkit/react`

### Vite + React

- **Runtime location:** Separate backend server (Express or Hono standalone). Vite dev server only serves the frontend.
- **Provider placement:** In the root `App.tsx` component
- **Frontend connects to external URL:** `runtimeUrl` points to the backend server
- **Stylesheet import:** In `main.tsx` or `App.tsx`: `import "@copilotkit/react/styles.css"`
- **Env file:** `.env` (Vite exposes vars prefixed with `VITE_`)
- **Note:** API keys should NOT be prefixed with `VITE_` -- they belong on the backend server, not exposed to the browser

### Standalone Backend (Express)

- **No framework detection needed** -- this is a backend-only setup
- **Uses:** `@copilotkit/runtime` and `@copilotkit/agent`
- **Does NOT need:** `@copilotkit/react` or `@copilotkit/core`
- **Endpoint factories:** `createCopilotEndpointExpress` (multi-route) or `createCopilotEndpointSingleRouteExpress` (single-route), both from `@copilotkit/runtime/express`
- **Env file:** `.env` (loaded via `dotenv`)

### Standalone Backend (Hono)

- **Same as Express** but uses `createCopilotEndpoint` or `createCopilotEndpointSingleRoute` from `@copilotkit/runtime`
- **Served via:** `@hono/node-server` with `serve({ fetch: app.fetch, port })`

## File-Level Detection Commands

When implementing framework detection in a skill, check these files:

```bash
# Next.js
ls next.config.{js,ts,mjs} 2>/dev/null

# App Router vs Pages Router
ls -d app src/app 2>/dev/null       # App Router
ls -d pages src/pages 2>/dev/null   # Pages Router

# Angular
ls angular.json 2>/dev/null

# Vite + React
ls vite.config.{js,ts} 2>/dev/null
grep -q '"react"' package.json 2>/dev/null

# Package manager
ls pnpm-lock.yaml 2>/dev/null && echo "pnpm"
ls yarn.lock 2>/dev/null && echo "yarn"
ls package-lock.json 2>/dev/null && echo "npm"
ls bun.lockb 2>/dev/null && echo "bun"
```
