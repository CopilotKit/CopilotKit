/**
 * Return the first configured standalone telemetry identity in HTTP form.
 *
 * Empty and whitespace-only values are unconfigured placeholders and must not
 * suppress a later identity source. Leading and trailing HTTP spaces and tabs
 * are removed before the selected value is stored or sent. Values containing
 * carriage returns or line feeds are invalid HTTP field values and are skipped.
 */
export function firstNonBlankTelemetryId(
  ...candidates: ReadonlyArray<string | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (candidate === undefined || /[\r\n]/.test(candidate)) {
      continue;
    }

    const normalized = candidate.replace(/^[\t ]+|[\t ]+$/g, "");
    if (normalized.trim().length > 0) {
      return normalized;
    }
  }

  return undefined;
}
