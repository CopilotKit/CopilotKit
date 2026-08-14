export interface DuplicateRegionSource {
  /** `"<integration-slug>::<demo-id>"` — used only for error messages. */
  demoKey: string;
  /**
   * The demo id on its own (the `<demo-id>` half of `demoKey`). This, NOT
   * `demoKey`, is what the allowlist is keyed by: demo source is ONE shared
   * copy under `frontends/nextjs/src/app/[integration]/demos/<demo-id>/`
   * serving every integration, so a duplicated region is a property of the
   * demo, never of the integration bundling it.
   *
   * Optional so a caller holding only the composite `demoKey` stays valid —
   * `findUnexpectedDuplicateRegions` then derives it via `demoIdFromKey`.
   */
  demoId?: string;
  regionName: string;
  /** Distinct files that open this region. Reported verbatim in errors. */
  files: string[];
  /**
   * TOTAL number of `@region[<name>] … @endregion[<name>]` slices carrying
   * this name across the demo — NOT the number of distinct files.
   *
   * This is the field the guard decides on. Counting distinct FILES let the
   * exact accident the guard exists to catch through: two copy-pasted
   * `@region[x]` blocks in the SAME file give one distinct file, so a
   * files-only guard skipped them entirely and the bundler's collapse loop
   * silently concatenated the two bodies into one snippet — with no
   * allowlist entry required.
   *
   * Optional for callers that genuinely have one slice per file (and for
   * older tests); it then falls back to `files.length`.
   */
  sliceCount?: number;
}

/**
 * Duplicated regions that are INTENTIONAL — a region name that deliberately
 * appears more than once inside one demo so the bundler concatenates the
 * bodies into a single snippet.
 *
 * Keyed `<demo-id>::<region-name>`. It used to be keyed
 * `<slug>::<demo-id>::<region-name>`, which needed one entry per integration:
 * 48 entries that were exactly 20 integrations x 2 regions of the SAME shared
 * source. That made adding integration #21 a hard bundler error on a demo
 * nobody had touched, and made one intentional multi-file region cost 20
 * lines. Since the source is shared, the demo id is the whole truth.
 *
 * Demo ids and region names are both kebab-case single segments, so `::`
 * cannot occur inside either half and the composite key is unambiguous —
 * unlike the old form, which embedded a `::`-containing `demoKey`.
 */
export const ALLOWED_DUPLICATE_REGION_KEYS = new Set([
  "headless-complete::custom-bubbles",
  "open-gen-ui-advanced::sandbox-function-registration",
]);

export function duplicateRegionKey(demoId: string, regionName: string): string {
  return `${demoId}::${regionName}`;
}

/**
 * Derive the demo id from a `"<integration-slug>::<demo-id>"` bundle key.
 * Exported so the bundler and the verifier build `DuplicateRegionSource`
 * identically instead of each slicing the key by hand.
 */
export function demoIdFromKey(demoKey: string): string {
  const separator = demoKey.indexOf("::");
  return separator === -1 ? demoKey : demoKey.slice(separator + "::".length);
}

/**
 * Regions that occur more than once inside a demo without an allowlist entry.
 *
 * The decision is on TOTAL slice count, so both shapes are caught: the same
 * name in two files, and the same name twice in one file.
 */
export function findUnexpectedDuplicateRegions(
  sources: DuplicateRegionSource[],
): DuplicateRegionSource[] {
  return sources.filter(
    (source) =>
      (source.sliceCount ?? source.files.length) > 1 &&
      !ALLOWED_DUPLICATE_REGION_KEYS.has(
        duplicateRegionKey(
          // Tolerate callers that only set `demoKey` (older call sites and
          // tests): derive the id rather than silently failing the guard
          // open on an `undefined` key.
          source.demoId ?? demoIdFromKey(source.demoKey),
          source.regionName,
        ),
      ),
  );
}

/**
 * Human-readable "where does this region come from" clause for an error
 * message. Shared so the bundler's hard error and the verifier's gate word
 * the same finding identically — a same-file duplicate must not be reported
 * as "appears in multiple files".
 */
export function describeDuplicateRegion(source: DuplicateRegionSource): string {
  const slices = source.sliceCount ?? source.files.length;
  if (source.files.length > 1) {
    return `appears in multiple files (${slices} regions): ${source.files.join(", ")}`;
  }
  return `appears ${slices} times in ${source.files[0] ?? "the demo"}`;
}
