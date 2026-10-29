# @copilotkit/v2-migration

Codemod that moves a CopilotKit app from v1 to 2.0. Published to the [Codemod registry](https://app.codemod.com/registry), not npm.

## Usage

Run it in the root of your app, on a clean git tree:

```bash
npx codemod @copilotkit/v2-migration
```

On a tree with uncommitted changes the CLI asks before it runs. In CI or any other non-interactive shell it waits for that answer forever, so pass `--allow-dirty` there.

Then finish with the skill it installs, or by hand: search for `TODO(copilotkit-2.0)`.

## What it does

- **Import paths.** `@copilotkit/react-core/v2` and `@copilotkit/runtime/v2` (and their subpaths) become the package roots. `@copilotkit/react-ui/styles.css` becomes `@copilotkit/react-core/styles.css`. Paths in `import()`, `require()`, and `vi.mock()` move too.
- **The provider.** The v1 `<CopilotKit>` (also re-exported from `/v2`) becomes `<CopilotKitProvider>`, and `CopilotKitProps` becomes `CopilotKitProviderProps`. On the provider, `agent` becomes `agentId`.
- **v1 APIs with the same 2.0 API.** The import moves to the 2.0 package, for example `CopilotChat` from `@copilotkit/react-ui` to `@copilotkit/react-core`.
- **LangGraph.** `LangGraphAgent` and `LangGraphHttpAgent` import from `@ag-ui/langgraph`.
- **Everything else** gets a `// TODO(copilotkit-2.0):` comment that names the 2.0 replacement and links its docs. The codemod does not rewrite a call whose arguments changed: `useCopilotAction` to `useFrontendTool` needs a Zod schema, and only you or an agent can write it.
- **A skill.** The last step installs an agent skill that resolves the TODOs, updates `package.json`, and runs your build.

## Runtime adapters in 2.0

The codemod automatically migrates named imports from the runtime root and the
`/express`, `/hono`, `/v2/express`, and `/v2/hono` entry points when all uses can
be resolved in the current file:

- Express factories become `createCopilotNodeListener`. The generated app-owned
  router preserves mount prefixes, request URLs seen by hooks, and `next()`
  fallthrough. Single endpoints register POST and OPTIONS on the exact path.
- Hono factories become `createCopilotRuntimeHandler`. Calls to `.fetch(request)`
  become direct calls, and root Hono `.route("/", endpoint)` mounts become Fetch
  callbacks. Inline factories are evaluated once at setup time.
- Next.js `handle(endpoint)` wrappers from `hono/vercel` are removed. The import
  stays if another Hono app in the file still uses it.
- Single-route factories receive `mode: "single-route"`. Omitted CORS becomes
  `cors: true`, preserving the old default. Supported literal Express CORS options
  are translated to the Fetch configuration's names.
- Aliases and existing bindings are preserved without introducing name collisions.
  Running the codemod again leaves the migrated handlers unchanged.

For example:

```ts
// Before
import { createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
const endpoint = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});
export const POST = handle(endpoint);

// After
import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
const endpoint = createCopilotRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});
export const POST = endpoint;
```

Router customization, exported/escaped app objects, shadowed bindings, dynamic
options, namespace/dynamic imports, and custom CORS callbacks receive a TODO.
Express CORS objects that implicitly reflect request headers also need manual
migration: the Fetch handler cannot reproduce that behavior with a static
wildcard. Framework dependencies are not removed from the app's package manifest;
they may still serve other routes.

See the [runtime migration guide](https://docs.copilotkit.ai/migrate/runtime-2.0)
for the remaining manual cases.

## Limits

- Run it **before** you upgrade the packages. In v1, `@copilotkit/react-core` and `@copilotkit/runtime` mean the v1 API, so the codemod reads them that way. Running it again on its own output changes nothing.
- Namespace imports (`import * as CK from "@copilotkit/react-core"`) only get a TODO.
- CSS `@import` lines are not changed.
- Import paths inside template literals (for example a script generated as a string) are not changed. Only plain string literals are.

## Develop

```bash
pnpm nx run @copilotkit/v2-migration:test         # fixtures in tests/ts and tests/tsx
pnpm nx run @copilotkit/v2-migration:test:runtime # compile and run the migrated Express/Hono fixture
pnpm nx run @copilotkit/v2-migration:check-types
pnpm nx run @copilotkit/v2-migration:validate     # the codemod package shape
```

Each fixture is a folder with `input` and `expected`. To refresh `expected` after a change, run `codemod jssg test` with `-u`, then read every diff before you commit it.

`scripts/v1-api.ts` is a snapshot of every v1 export and its 2.0 replacement, taken before v1 was deleted. Do not edit it by hand. Corrections that came after the snapshot go in `OVERRIDES` in `scripts/codemod.ts`.
