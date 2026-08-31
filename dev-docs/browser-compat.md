# Browser Compatibility

## Browserslist Matrix

The `.browserslistrc` at the repo root declares the intended browser support policy. It is useful for tools that read browserslist directly (e.g. PostCSS autoprefixer, documentation generators). To see the current resolved matrix, run:

```
npx browserslist
```

The resolved set changes over time as `defaults` is a dynamic query maintained by the browserslist project — there is no fixed version table in this doc.

One entry is explicitly excluded: `not kaios 2.5`. KaiOS 2.5 ships a Gecko 48-era engine and is documented here as out-of-scope so that consumers of this policy (autoprefixer and similar tools) know not to target it.

Note: `.browserslistrc` does **not** drive `compat-check`. The `es-check` targets (ES2022 for ESM/CJS; ES2018 for UMD, except `@copilotkit/react-core` UMD which uses ES2020 — see "What `compat-check` Does" below) are hardcoded in the `compat-check` scripts and are independent of the browserslist query. See the "Decoupled" section below for why these two concerns are kept separate.

## What `compat-check` Does

`compat-check` runs `es-check` against the built `dist/` output after a build:

- **ESM and CJS files** are checked against **ES2022** (matches the `tsdown` `target: "es2022"` setting for all packages).
- **UMD files** are checked against **ES2018** for all packages except `@copilotkit/react-core`, which uses **ES2020** because its source contains dynamic `import()` expressions that cannot be downcompiled to ES2018 by rollup when the imported modules are external.

If any file uses syntax above the target level, `es-check` fails loudly with the offending file and the problematic feature. The check runs in CI so failures surface before a release.

## Why It Is Decoupled from the `tsdown` Target

`tsdown`'s `target` option tells the compiler what it _should_ emit — but there are two ways the actual output syntax can exceed that target without tsdown itself introducing the violation:

1. **Transitive dependencies.** Bundled code from a dep can carry syntax that was never downcompiled because tsdown only transforms its own output, not pre-compiled dep artifacts.
2. **tsdown version bumps.** A new tsdown version may change how it handles certain patterns, inadvertently emitting newer syntax.

Neither of those failures would be caught by reading the tsdown config. The `compat-check` catches them by inspecting the real built artifacts, so drift is detected before a customer encounters a parse error in a supported browser.

## Handling a Failure

When `compat-check` fails, the output from `es-check` will name the offending file and the syntax it objected to. The decision tree is:

1. **Identify the offending file.** Look at the `es-check` error output — it will point to a specific file in `dist/`.
2. **Trace it to a dep or to first-party code.** Check whether the syntax comes from a bundled dependency or from code we wrote. Source maps or a quick `grep` of the dist file for a known identifier usually clarifies this.
3. **Decide:**
   - If the violation came from **a dep update** that unintentionally introduced newer syntax: pin or override the dep, or open an issue upstream asking them to ship a downcompiled artifact.
   - If we **intentionally dropped support** for an older browser tier: raise the `es-check` target in the `compat-check` script and update this document to match. Note: updating `.browserslistrc` has no effect on `compat-check` — the es-check targets are hardcoded in the scripts and are independent of the browserslist query.

Do not suppress the failure or widen the allowed syntax band without updating the `compat-check` targets and this document to match.
