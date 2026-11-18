// Web-standard replacements for the `node:crypto` and `Buffer` helpers the
// runtime used to import. They run unchanged on Node, Cloudflare Workers
// (without `nodejs_compat`), Vercel Edge, Deno, and Bun.

/** Lowercase hex SHA-256 of raw bytes or a UTF-8 string. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// `String.fromCharCode(...chunk)` spreads its argument onto the stack, so
// chunk large inputs to stay well under engine argument limits.
const BASE64_CHUNK_BYTES = 0x8000;

/** Standard (non-URL) base64 with padding, identical to `Buffer#toString("base64")`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}
