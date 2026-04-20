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

const g = globalThis as Record<string, unknown>;

if (typeof g.ReadableStream === "undefined") {
  g.ReadableStream = ReadableStream;
  g.WritableStream = WritableStream;
  g.TransformStream = TransformStream;
}
