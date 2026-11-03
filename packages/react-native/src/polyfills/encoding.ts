/**
 * Polyfill: TextEncoder, TextDecoder
 *
 * Required for stream chunk processing in CopilotKit. The polyfill supports
 * UTF-8, the only encoding that CopilotKit uses.
 * Skipped if the globals are already defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/encoding";
 */

import { Utf8TextDecoder, Utf8TextEncoder } from "./utf8";

const g = globalThis as Record<string, unknown>;

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = Utf8TextEncoder;
}
if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = Utf8TextDecoder;
}
