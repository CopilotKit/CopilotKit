# @copilotkit/v2-migration

Codemod that moves a CopilotKit app from v1 to 2.0. Published to the [Codemod registry](https://app.codemod.com/registry), not npm.

## Usage

Run it in the root of your app, on a clean git tree:

```bash
npx codemod @copilotkit/v2-migration
```

Then finish with the skill it installs, or by hand: search for `TODO(copilotkit-2.0)`.

## What it does

- **Import paths.** `@copilotkit/react-core/v2` and `@copilotkit/runtime/v2` (and their subpaths) become the package roots. `@copilotkit/react-ui/styles.css` becomes `@copilotkit/react-core/styles.css`. Paths in `import()`, `require()`, and `vi.mock()` move too.
- **The provider.** `CopilotKitProvider` becomes `CopilotKit`, and `CopilotKitProviderProps` becomes `CopilotKitProps`. On `<CopilotKit>`, `agent` becomes `agentId`.
- **v1 APIs with the same 2.0 API.** The import moves to the 2.0 package, for example `CopilotChat` from `@copilotkit/react-ui` to `@copilotkit/react-core`.
- **LangGraph.** `LangGraphAgent` and `LangGraphHttpAgent` import from `@ag-ui/langgraph`.
- **Everything else** gets a `// TODO(copilotkit-2.0):` comment that names the 2.0 replacement and links its docs. The codemod does not rewrite a call whose arguments changed: `useCopilotAction` to `useFrontendTool` needs a Zod schema, and only you or an agent can write it.
- **A skill.** The last step installs an agent skill that resolves the TODOs, updates `package.json`, and runs your build.

## Limits

- Run it **before** you upgrade the packages. In v1, `@copilotkit/react-core` and `@copilotkit/runtime` mean the v1 API, so the codemod reads them that way. Running it again on its own output changes nothing.
- Namespace imports (`import * as CK from "@copilotkit/react-core"`) only get a TODO.
- CSS `@import` lines are not changed.

## Develop

```bash
pnpm nx run @copilotkit/v2-migration:test         # fixtures in tests/ts and tests/tsx
pnpm nx run @copilotkit/v2-migration:check-types
pnpm nx run @copilotkit/v2-migration:validate     # the codemod package shape
```

Each fixture is a folder with `input` and `expected`. To refresh `expected` after a change, run `codemod jssg test` with `-u`, then read every diff before you commit it.

`scripts/v1-api.ts` is a snapshot of every v1 export and its 2.0 replacement, taken before v1 was deleted. Do not edit it by hand. Corrections that came after the snapshot go in `OVERRIDES` in `scripts/codemod.ts`.
