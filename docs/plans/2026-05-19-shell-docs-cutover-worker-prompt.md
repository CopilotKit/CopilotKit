# Shell-docs port worker — `{{FRAMEWORK_SLUG}}`

You are porting v1 docs content for the `{{FRAMEWORK_SLUG}}` framework into the new shell-docs IA. Your boundary is `showcase/shell-docs/src/content/docs/integrations/{{FRAMEWORK_SLUG}}/` and (if needed) `showcase/shell-docs/src/content/snippets/integrations/{{FRAMEWORK_SLUG}}/`. Do not touch anything outside that boundary.

## Inputs

- Punch list: `showcase/scripts/audit-output/{{FRAMEWORK_SLUG}}.json` (missing + divergent pages for this framework).
- Component mapping: `showcase/scripts/lib/component-mapping.ts` (drives import fixes). Almost all v1 components are already pre-shimmed in `showcase/shell-docs/src/lib/mdx-registry.tsx` — the mapping tells you exactly which target to use.
- v1 source root: `docs/content/docs/integrations/{{FRAMEWORK_SLUG}}/`.
- Target root: `showcase/shell-docs/src/content/docs/integrations/{{FRAMEWORK_SLUG}}/`.
- v1 snippet root: `docs/snippets/integrations/{{FRAMEWORK_SLUG}}/`.
- Target snippet root: `showcase/shell-docs/src/content/snippets/integrations/{{FRAMEWORK_SLUG}}/`.

## Loop

For each file in the punch list's `missing` array (in alphabetical order):

1. Copy the v1 file to the target path. Mirror the relative path exactly (`docs/content/docs/integrations/{{FRAMEWORK_SLUG}}/<rel>` → `showcase/shell-docs/src/content/docs/integrations/{{FRAMEWORK_SLUG}}/<rel>`).
2. Open the copied file. For each JSX component name used (matching `/<[A-Z][A-Za-z0-9]*\b/`):
   - Look up `lookupMapping(name)` in `showcase/scripts/lib/component-mapping.ts`.
   - If `kind: "use-existing"` and `target` differs from the name, rename the tag.
   - If `kind: "shim"` or `kind: "use-existing"` and `target` equals the name, leave the tag as-is. The shell-docs `mdx-registry.tsx` resolves it.
   - If the component is not in the mapping, treat it as a NEW unknown — do not invent a fix. Add it to your worker report under "Unmapped components found" and leave the page as-is. The coordinator will resolve.
3. For each `@/snippets/...` or relative-path import:
   - If the path resolves under `showcase/shell-docs/src/content/snippets/` already, leave it.
   - If not, find the corresponding v1 source (likely under `docs/snippets/`), and copy it to the matching path under `showcase/shell-docs/src/content/snippets/`. If that v1 snippet imports OTHER snippets, recurse into them.
4. If `meta.json` for this framework needs to surface the new page in the sidebar, edit it. Add the page slug to the appropriate location preserving existing order.
5. Run `cd showcase/scripts && npm run verify-shell-docs:fast 2>&1 | tee /tmp/verify-{{FRAMEWORK_SLUG}}.txt`. Compare against the baseline at the bottom of this prompt — only NEW failures attributable to your framework are blockers. Pre-existing failures from other frameworks (NOT in `integrations/{{FRAMEWORK_SLUG}}/`) are not your responsibility.
6. Run essential-content check via `npx vitest run showcase/scripts/lib/essential-content.test.ts`. (For now, this just verifies the checker itself; per-page essential-content failures are reported in the verifier output as `[FAIL] essential-content`.)
7. If both gates are clean for the file you just ported, mark the punch-list item done and move to the next.

For each file in the punch list's `divergent` array:

- Open both files side-by-side. The shell-docs version is the source of truth ONLY if it was authored after the design-doc cutover date (2026-05-19) in the file's git log; otherwise overwrite shell-docs with the v1 version and re-run steps 2–6.

## Output

- All files in the punch list ported and passing both gates.
- Summary on stdout: `Ported N pages, M divergent files reconciled, K unmapped components, 0 verifier failures attributable to {{FRAMEWORK_SLUG}}.`
- Commit on the worker's branch with message: `feat(shell-docs): port v1 docs for {{FRAMEWORK_SLUG}}`.

## Coordinator escalation

Report BLOCKED and stop if you encounter:
- A v1 page that imports a snippet whose source file you can't find anywhere.
- A page where the v1 implementation uses a component the mapping classifies as `use-existing` but the target doesn't actually exist in shell-docs (e.g. the mapping is wrong).
- A divergent page where v1 and shell-docs both have content you genuinely can't reconcile.
- Verifier output that's so large you can't parse what's new vs baseline.

## Verifier baseline (pre-existing failures for {{FRAMEWORK_SLUG}})

```
{{VERIFIER_BASELINE_FOR_FRAMEWORK}}
```

Anything above this baseline that you didn't introduce is pre-existing and NOT yours to fix.
