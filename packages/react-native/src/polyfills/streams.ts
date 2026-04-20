/**
 * Polyfill: ReadableStream, WritableStream, TransformStream
 *
 * Required for SSE streaming in CopilotKit.
 * Skipped if the global already has ReadableStream defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/streams";
 */

import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from "web-streams-polyfill";

if (typeof globalThis.ReadableStream === "undefined") {
  (globalThis as any).ReadableStream = ReadableStream;
  (globalThis as any).WritableStream = WritableStream;
  (globalThis as any).TransformStream = TransformStream;
}
