# AGENTS.md — `@copilotkit/vue`

Agent entrypoint for working in this package.

## Scope

- All work is in `packages/vue/**`.
- React is the canonical behavioral reference: `packages/react-core/`, `packages/react-ui/`, `packages/react-textarea/`.

## Required Reading

| Doc | When |
|-----|------|
| [CONTRIBUTOR_GUIDE.md](./CONTRIBUTOR_GUIDE.md) | Before starting any work — explains workflow, validation, and conventions |
| [PARITY.md](./PARITY.md) | Before porting a feature or adding tests — contains the translation decision tree, strict test rules, and the living matrix |
| [README.md](./README.md) | When touching public API surface — this is the user-facing doc |

## Hard Requirements

1. **Always run validation** after changes: `lint`, `check-types`, `test` (and `build` if touching exports).
2. **Update PARITY.md** in the same commit when behavior or tests change.
3. **Mirror React test naming** (`describe`/`it` text) for near-100% translatable features.
4. **Document divergences** in PARITY.md before introducing Vue-specific API translations.
5. **Slots are primary**; programmatic renderers (`renderCustomMessages`, `renderToolCalls`) are secondary.
6. **Do not modify files outside `packages/vue/`** unless explicitly approved.

## Validation

```bash
pnpm nx run @copilotkit/vue:lint
pnpm nx run @copilotkit/vue:check-types
pnpm nx run @copilotkit/vue:test
pnpm nx run @copilotkit/vue:build   # when touching exports/build
```
