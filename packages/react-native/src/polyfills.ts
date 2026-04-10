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

// crypto.getRandomValues — needed by uuid (Math.random fallback; NOT cryptographically secure).
// For apps requiring secure randomness, install react-native-get-random-values before this polyfill.
if (typeof global.crypto === "undefined") {
  (global as any).crypto = {};
}
if (!(global.crypto as any).getRandomValues) {
  if (__DEV__) {
    console.warn(
      "[CopilotKit] Installing non-cryptographic crypto.getRandomValues polyfill (Math.random). " +
        "This is NOT secure for cryptographic operations. Install 'react-native-get-random-values' " +
        "for a secure implementation.",
    );
  }
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

// Headers — needed by CopilotKit's request construction
if (typeof (global as any).Headers === "undefined") {
  class HeadersPolyfill {
    private _map: Record<string, string> = {};
    constructor(init?: Record<string, string> | HeadersPolyfill) {
      if (init) {
        if (init instanceof HeadersPolyfill) {
          this._map = { ...init._map };
        } else {
          for (const [key, value] of Object.entries(init)) {
            this._map[key.toLowerCase()] = value;
          }
        }
      }
    }
    get(name: string): string | null {
      return this._map[name.toLowerCase()] ?? null;
    }
    set(name: string, value: string): void {
      this._map[name.toLowerCase()] = value;
    }
    has(name: string): boolean {
      return name.toLowerCase() in this._map;
    }
    delete(name: string): void {
      delete this._map[name.toLowerCase()];
    }
    entries(): IterableIterator<[string, string]> {
      return Object.entries(this._map)[Symbol.iterator]();
    }
    keys(): IterableIterator<string> {
      return Object.keys(this._map)[Symbol.iterator]();
    }
    values(): IterableIterator<string> {
      return Object.values(this._map)[Symbol.iterator]();
    }
    forEach(
      callback: (value: string, key: string, parent: HeadersPolyfill) => void,
    ): void {
      for (const [key, value] of Object.entries(this._map)) {
        callback(value, key, this);
      }
    }
  }
  (global as any).Headers = HeadersPolyfill;
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

// Streaming fetch — RN's built-in fetch doesn't support response.body (ReadableStream).
// Installs an XHR-based replacement that streams chunks, enabling SSE agent communication.
// Skipped automatically if native fetch already supports ReadableStream bodies.
import { installStreamingFetch } from "./streaming-fetch";
installStreamingFetch();
