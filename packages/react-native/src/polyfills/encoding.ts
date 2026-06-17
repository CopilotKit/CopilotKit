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

const g = globalThis as Record<string, unknown>;

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = TextEncoder;
}
if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = TextDecoder;
}
