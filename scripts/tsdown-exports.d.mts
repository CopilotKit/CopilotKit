/**
 * A value in a package.json `exports` map: a target path, `null` (blocks a
 * subpath), a fallback array, or a nested conditions object.
 */
export type ExportsEntry =
  | string
  | null
  | ExportsEntry[]
  | { [condition: string]: ExportsEntry };

/**
 * Post-process tsdown's generated `exports` map so every `import`/`require`
 * target that points at emitted JavaScript gains a matching `types` condition.
 * See `tsdown-exports.mjs` and CopilotKit issue #3324.
 */
export declare function withTypesConditions(
  exports: Record<string, ExportsEntry>,
  ctx: { pkg: unknown },
): Record<string, ExportsEntry>;
