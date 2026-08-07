const PORTABLE_SINGLE_VALUE_PREFIX = "ck-portable-single:";

/** Mark a provider-neutral single-value modal field in its Discord custom ID. */
export function encodePortableSingleValueField(fieldId: string): string {
  return `${PORTABLE_SINGLE_VALUE_PREFIX}${fieldId}`;
}

/** Recover a provider-neutral single-value field ID, if this is one. */
export function decodePortableSingleValueField(
  customId: string,
): string | undefined {
  if (!customId.startsWith(PORTABLE_SINGLE_VALUE_PREFIX)) return undefined;
  return customId.slice(PORTABLE_SINGLE_VALUE_PREFIX.length) || undefined;
}
