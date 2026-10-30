export function randomId() {
  return "ck-" + randomUUID();
}

/**
 * Returns an RFC 4122 version 4 UUID. Uses `crypto.randomUUID()` when it
 * exists, and builds the UUID from `crypto.getRandomValues()` when it does not
 * (React Native's Hermes has no `randomUUID`).
 */
export function randomUUID(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto?.getRandomValues !== "function") {
    throw new Error(
      "crypto.getRandomValues() is not available. In React Native, install a polyfill such as react-native-get-random-values.",
    );
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
