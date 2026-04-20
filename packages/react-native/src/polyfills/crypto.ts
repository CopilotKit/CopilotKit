/**
 * Polyfill: crypto.getRandomValues
 *
 * Required by uuid generation in CopilotKit. Uses Math.random — NOT
 * cryptographically secure. For secure randomness, install
 * react-native-get-random-values before this polyfill.
 *
 * Skipped if crypto.getRandomValues is already defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/crypto";
 */

if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = {};
}
if (!(globalThis.crypto as any).getRandomValues) {
  console.warn(
    "[CopilotKit] Installing non-cryptographic crypto.getRandomValues polyfill (Math.random). " +
      "This is NOT secure for cryptographic operations. Install 'react-native-get-random-values' " +
      "for a secure implementation.",
  );
  (globalThis.crypto as any).getRandomValues = function (
    array: Uint8Array,
  ): Uint8Array {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}
