/** A value in a package.json `exports` map: a target path or a nested conditions object. */
export type ExportEntry = string | { [condition: string]: ExportEntry };

/**
 * Post-process tsdown's generated `exports` map so every `import`/`require`
 * target that points at emitted JavaScript gains a matching `types` condition.
 * See `tsdown-exports.mjs` and CopilotKit issue #3324.
 */
export declare function withTypesConditions(
  exports: Record<string, ExportEntry>,
  ctx: { pkg: unknown },
): Record<string, ExportEntry>;
