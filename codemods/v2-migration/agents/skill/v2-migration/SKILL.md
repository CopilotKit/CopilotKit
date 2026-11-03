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

The codemod already did the mechanical part: `/v2` import paths now point at the package roots, `<CopilotKit>` is `<CopilotKitProvider>`, `agent=` is `agentId=`, and LangGraph agents import from `@ag-ui/langgraph`. Everything it could not do safely is marked with a `TODO(copilotkit-2.0):` comment next to the code.

## Rules

- **Never rename a v1 hook to its 2.0 name and stop.** The 2.0 APIs take different arguments. `useCopilotAction` becomes `useFrontendTool` with a Zod schema, not a `Parameter[]` list. Rewrite the call, not just the name.
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
   - add `@ag-ui/langgraph` if the code now imports from it;
   - remove `streamdown`, `streamdown-vue`, `react-native-streamdown`, and `katex` if the code no longer imports them.
4. Install, then run the typecheck and the build. Fix what they report.
5. Report to the user: what changed, each v1 feature that has no 2.0 equivalent, and anything you could not verify.

See `references/index.md` for the reference files.
