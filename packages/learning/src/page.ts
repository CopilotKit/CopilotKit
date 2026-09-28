import type { ProductPageContext } from "./types";

const MAX_PATH_BYTES = 1024;
const credential =
  /password|passwd|secret|token|api[-_]?key|authorization|credential|session[-_]?id|access[-_]?key|bearer/i;
const credentialKey = new RegExp(`(?:^|[-_])(?:${credential.source})$`, "i");
const privateSlug = /(?:^|[-_])(?:private|internal|confidential)(?:$|[-_])/i;
const numeric = /(?:\p{N}[\s(),+._-]*){4,}/u;

/** Bounded heuristics, not anonymization of arbitrary route names or slugs. */
export function describePage(location: {
  protocol: string;
  pathname: string;
}): ProductPageContext {
  try {
    if (!/^https?:$/.test(location.protocol))
      return { omitted: "unsupported-location" };
    const pathname = location.pathname;
    if (
      pathname.length > MAX_PATH_BYTES ||
      new TextEncoder().encode(pathname).byteLength > MAX_PATH_BYTES
    )
      return { omitted: "size-limit" };
    if (!pathname.startsWith("/")) return { omitted: "unsupported-location" };
    let redacted = false;
    let credentialValue = false;
    const segments = pathname.split("/").map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      let malformed = false;
      try {
        // Never repeatedly decode until stable: both work and inspection depth
        // are bounded. Remaining escapes are conservatively redacted below.
        for (let pass = 0; pass < 2 && decoded.includes("%"); pass++)
          decoded = decodeURIComponent(decoded);
      } catch {
        malformed = true;
      }
      const hasCredentialHint = credential.test(decoded);
      const suspicious =
        credentialValue ||
        malformed ||
        hasCredentialHint ||
        privateSlug.test(decoded) ||
        decoded.includes("%") ||
        /[\s@/\\?#\p{Cc}\p{Cf}]/u.test(decoded) ||
        decoded === "." ||
        decoded === ".." ||
        /^\p{N}+$/u.test(decoded) ||
        numeric.test(decoded) ||
        /^[a-f\d]{16,}$/i.test(decoded) ||
        /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(decoded) ||
        (/^[a-z\d_+=-]{24,}$/i.test(decoded) &&
          !/^[a-z]+(?:-[a-z]+)+$/.test(decoded));
      // A credential key may put its short value in the next path segment.
      credentialValue = credentialKey.test(decoded);
      if (!suspicious) return segment;
      redacted = true;
      return ":redacted";
    });
    const filtered = segments.join("/");
    if (new TextEncoder().encode(filtered).byteLength > MAX_PATH_BYTES)
      return { omitted: "size-limit" };
    return redacted
      ? { pathname: filtered, redacted: true }
      : { pathname: filtered };
  } catch {
    // Optional metadata must not stop capture when a location is unreadable.
    return { omitted: "unsupported-location" };
  }
}
