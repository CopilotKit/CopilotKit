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

export {};

const g = globalThis as Record<string, unknown>;

if (typeof g.crypto === "undefined") {
  g.crypto = {};
}
const cryptoObj = g.crypto as Record<string, unknown>;
if (!cryptoObj.getRandomValues) {
  console.warn(
    "[CopilotKit] Installing non-cryptographic crypto.getRandomValues polyfill (Math.random). " +
      "This is NOT secure for cryptographic operations. Install 'react-native-get-random-values' " +
      "for a secure implementation.",
  );
  cryptoObj.getRandomValues = function (array: Uint8Array): Uint8Array {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}
