/**
 * Polyfills required for CopilotKit to work in React Native.
 *
 * Import this BEFORE any CopilotKit code in your app entry point:
 *   import "@copilotkit/react-native/polyfills";
 */

import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from "web-streams-polyfill";
import { TextEncoder, TextDecoder } from "text-encoding";

declare const global: typeof globalThis;

// ReadableStream — needed for SSE streaming in CopilotKit
if (typeof global.ReadableStream === "undefined") {
  (global as any).ReadableStream = ReadableStream;
  (global as any).WritableStream = WritableStream;
  (global as any).TransformStream = TransformStream;
}

// TextEncoder/TextDecoder — needed for stream processing
if (typeof global.TextEncoder === "undefined") {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  (global as any).TextDecoder = TextDecoder;
}

// crypto.getRandomValues — needed by uuid
if (typeof global.crypto === "undefined") {
  (global as any).crypto = {};
}
if (!(global.crypto as any).getRandomValues) {
  (global.crypto as any).getRandomValues = function (
    array: Uint8Array,
  ): Uint8Array {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}

// DOMException — used by CopilotKit's isAbortError check
if (typeof (global as any).DOMException === "undefined") {
  class DOMExceptionPolyfill extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name || "DOMException";
      this.code = 0;
    }
  }
  (global as any).DOMException = DOMExceptionPolyfill;
}

// window.location — CopilotKit's shouldShowDevConsole checks window.location.hostname
if (typeof window !== "undefined" && !(window as any).location) {
  (window as any).location = {
    hostname: "localhost",
    href: "http://localhost",
    origin: "http://localhost",
    protocol: "http:",
    host: "localhost",
    pathname: "/",
    search: "",
    hash: "",
  };
}
