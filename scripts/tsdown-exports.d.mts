/**
 * A value in a package.json `exports` map: a target path, `null` (blocks a
 * subpath), a fallback array, or a nested conditions object.
 *
 * Mirror of `ExportsEntry` in `scripts/validate-package-exports-types.ts`;
 * the two are hand-kept in sync (a `.d.mts` declaration and a `.ts` script
 * cannot share one source without coupling the build helper to the validator).
 */
export type ExportsEntry =
  | string
  | null
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry };

/**
 * Post-process tsdown's generated `exports` map so every condition target
 * (`import`/`require`/…) and bare-string target that points at emitted
 * JavaScript gains a matching `types` condition. See `tsdown-exports.mjs` and
 * CopilotKit issue #3324.
 *
 * `ctx.pkg` is intentionally `unknown` (the runtime reads `pkg.packageJsonPath`):
 * tsdown's public `PackageJson` type omits `packageJsonPath`, and a
 * `{ packageJsonPath?: string }` shape is an all-optional "weak type" that
 * `PackageJson` cannot satisfy — so tightening it breaks `customExports`
 * assignability (check-types) at the call sites. Do not narrow it.
 */
export declare function withTypesConditions(
  exports: Record<string, ExportsEntry>,
  ctx: { pkg: unknown },
): Record<string, ExportsEntry>;
