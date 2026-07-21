/**
 * Return the first configured standalone telemetry identity without rewriting it.
 *
 * Empty and whitespace-only values are unconfigured placeholders and must not
 * suppress a later identity source. Trimming is used only for the presence
 * check; the selected opaque identity is returned unchanged.
 */
export function firstNonBlankTelemetryId(
  ...candidates: ReadonlyArray<string | undefined>
): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && candidate.trim().length > 0,
  );
}
