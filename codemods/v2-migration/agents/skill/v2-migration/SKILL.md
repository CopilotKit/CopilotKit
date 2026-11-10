---
name: "@copilotkit/v2-migration"
description: "Use after the @copilotkit/v2-migration codemod has run on a CopilotKit app, or when code still has `TODO(copilotkit-2.0)` comments, still imports v1 CopilotKit APIs, or fails to build after upgrading to CopilotKit 2.0."
allowed-tools:
  - Bash(codemod *)
  - Bash(grep *)
  - Bash(git *)
---

# Finish a CopilotKit 2.0 migration

codemod-compatibility: skill-package-v1
codemod-skill-version: 0.1.0

The codemod already did the mechanical part: `/v2` import paths now point at the package roots, `<CopilotKit>` is `<CopilotKitProvider>`, `agent=` is `agentId=`, LangGraph agents import from `@ag-ui/langgraph`, and `BuiltInAgent` model strings are TanStack AI adapters. Each `useCopilotReadable` call is now `useAgentContext`, each destructured `useCoAgent` and `useCopilotChat()` call is `useAgent` with the same values, `new TextMessage(...)` is a plain AG-UI message, a v1 App Router endpoint with an OpenAI, Anthropic, Google or empty service adapter is `createCopilotRuntimeHandler` with a `BuiltInAgent`, and each `useCopilotAction` call with a literal `Parameter[]` is now `useFrontendTool`, `useHumanInTheLoop` or `useRenderTool` with a Zod schema, and the `labels` of the v1 chat components use the 2.0 keys. Everything it could not do safely is marked with a `TODO(copilotkit-2.0):` comment next to the code.

## Rules

- **Never rename a v1 hook to its 2.0 name and stop.** The 2.0 APIs take different arguments. A `useCopilotAction` call that is left becomes `useFrontendTool` (a `handler`), `useHumanInTheLoop` (`renderAndWaitForResponse`) or `useRenderTool` (only `render`), with a Zod schema instead of a `Parameter[]` list. Rewrite the call, not just the name. The calls the codemod already rewrote show the pattern.
- **Read the docs link in the TODO** before you rewrite a call. The link points at the exact 2.0 API.
- **Delete each TODO comment once its code is fixed.** A TODO left in the file means the work is not done.
- **Markdown lost features by default.** The built-in renderer does no syntax highlighting, math, or mermaid diagrams. Before you delete a Streamdown prop, read the "Markdown rendering" section of `references/mappings.md`.
- **Keep behavior the same.** If a v1 feature has no 2.0 equivalent, stop and ask the user before you drop it.

## Steps

1. List the work: `grep -rn "TODO(copilotkit-2.0)" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" .`
2. Fix each TODO with `references/mappings.md`, then delete the comment.
3. Update `package.json`:
   - set every `@copilotkit/*` dependency to the same 2.x version;
   - remove `@copilotkit/react-ui`, `@copilotkit/react-textarea`, and `@copilotkit/runtime-client-gql`;
   - use `zod` 4 (`^4.2.0`): add it if the code imports it and `package.json` does not list it (the codemod writes the tool schemas with Zod), and move an app on zod 3 to zod 4 (Zod's v3-to-v4 guide covers the API changes). Keep one zod major in the tree, with an override if a dependency pulls zod 3: `@ag-ui/client` has zod as a peer, so a second zod installs a second `AbstractAgent`;
   - add `@ag-ui/langgraph` if the code now imports from it;
   - set `@ag-ui/client`, `@ag-ui/core` and `@ag-ui/encoder` to the version the `@copilotkit/*` packages depend on (`npm ls @ag-ui/client` shows it). If an agent integration brings its own `@ag-ui/client`, force one version with `pnpm.overrides`, npm `overrides` or yarn `resolutions`: two copies of `AbstractAgent` make every agent fail to type-check ("missing the following properties: \_threadId, ...");
   - if the code imports from `@copilotkit/runtime/agent`, add `@tanstack/ai` and the adapter package for each provider it uses: `@tanstack/ai-openai`, `@tanstack/ai-anthropic`, `@tanstack/ai-gemini`, or `@tanstack/ai-vertex` (see the Built-in Agent section of `references/mappings.md`);
   - add `@tanstack/ai-mcp` if the code imports `createMCPClient`;
   - add `ai` only if the code imports from `@copilotkit/runtime/agent/ai-sdk`;
   - remove `streamdown`, `streamdown-vue`, `react-native-streamdown`, and `katex` if the code no longer imports them.
4. Install, then run the typecheck and the build. Fix what they report.
   - The TanStack AI packages (`@tanstack/ai*`) are ESM only. A CommonJS server (no `"type": "module"`, or `"module": "commonjs"` in `tsconfig.json`) cannot `import` them statically: move the server to ESM, or load the adapter with `await import("@tanstack/ai-openai")`.
5. Report to the user: what changed, each v1 feature that has no 2.0 equivalent, and anything you could not verify.

See `references/index.md` for the reference files.
