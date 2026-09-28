const MAX_REFERENCES = 256;
const privateHint =
  /password|passwd|passcode|secret|token|auth|credential|session|cookie|bearer|api[-_]?key|access[-_]?(?:key|code)|private|internal|confidential|email|phone/i;

function identifier(value: string | number): string | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return;
  const text = String(value);
  if (
    text.length === 0 ||
    text.length > 128 ||
    !/^[a-z\d_-]+$/i.test(text) ||
    privateHint.test(text)
  )
    return;
  return text;
}

function decodeSegment(value: string): string | undefined {
  try {
    let result = value;
    for (let pass = 0; pass < 2 && result.includes("%"); pass++)
      result = decodeURIComponent(result);
    return result.includes("%") ? undefined : result;
  } catch {
    return;
  }
}

function opaquePathSegment(value: string): boolean {
  return (
    /^\d+$/.test(value) ||
    /^(?:[a-z]+[-_])+\d{4,}$/i.test(value) ||
    /^[a-f\d]{16,}$/i.test(value) ||
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ||
    (/^[a-z\d_-]{24,}$/i.test(value) && !/^[a-z]+(?:-[a-z]+)+$/.test(value))
  );
}

/** Capture-local aliases, never persisted hashes or globally reusable identity. */
export function createObjectReferences() {
  const references = new Map<string, string>();
  function reference(value: string | number): string | undefined {
    const key = identifier(value);
    if (key === undefined) return;
    const existing = references.get(key);
    if (existing) return existing;
    if (references.size >= MAX_REFERENCES) return;
    const result = `object-${references.size + 1}`;
    references.set(key, result);
    return result;
  }
  return {
    reference,
    forUrl(
      rawUrl: string,
      base: string,
      safeUrl: string,
    ): Array<{ pathSegment: number; reference: string }> | undefined {
      try {
        const raw = new URL(rawUrl, base);
        const safe = new URL(safeUrl, base);
        if (
          !/^https?:$/.test(raw.protocol) ||
          raw.origin !== safe.origin ||
          raw.username ||
          raw.password ||
          raw.pathname.length > 1024
        )
          return;
        const segments = raw.pathname.split("/").filter(Boolean);
        const filtered = safe.pathname.split("/").filter(Boolean);
        if (segments.length !== filtered.length) return;
        const decoded = segments.map(decodeSegment);
        // A redacted credential or private route is not a business object ID.
        if (
          decoded.some(
            (segment) =>
              segment === undefined ||
              privateHint.test(segment) ||
              /[\s@/\\?#\p{Cc}\p{Cf}]/u.test(segment),
          )
        )
          return;
        const result: Array<{ pathSegment: number; reference: string }> = [];
        for (let index = 0; index < segments.length; index++) {
          const value = decoded[index]!;
          if (filtered[index] !== ":redacted" || !opaquePathSegment(value))
            continue;
          const token = reference(value);
          // Index counts nonempty pathname segments, starting at zero.
          if (token) result.push({ pathSegment: index, reference: token });
          if (result.length >= 8) break;
        }
        return result.length ? result : undefined;
      } catch {
        return;
      }
    },
    clear() {
      references.clear();
    },
  };
}
