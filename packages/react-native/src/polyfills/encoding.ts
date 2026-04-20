/**
 * Polyfill: TextEncoder, TextDecoder
 *
 * Required for stream chunk processing in CopilotKit.
 * Skipped if the globals are already defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/encoding";
 */

import { TextEncoder, TextDecoder } from "text-encoding";

if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as any).TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as any).TextDecoder = TextDecoder;
}
