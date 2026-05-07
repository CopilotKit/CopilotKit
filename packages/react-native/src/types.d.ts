// React Native global provided by Metro bundler
declare const __DEV__: boolean;

// Polyfill files use `const g = globalThis as Record<string, unknown>` to assign
// web APIs (ReadableStream, TextEncoder, Headers, etc.) that may not exist in the
// React Native runtime. TypeScript's `globalThis` type doesn't include optional
// web APIs, so there's no way to assign them without a cast. We use a local alias
// (`g`) instead of repeating `(globalThis as any)` on every line — same pattern as
// packages/angular/src/test-setup.ts. Files without imports add `export {}` so
// TypeScript treats them as modules with isolated scope.

declare module "text-encoding" {
  export class TextEncoder {
    encode(input?: string): Uint8Array;
  }
  export class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean });
    decode(
      input?: ArrayBufferView | ArrayBuffer,
      options?: { stream?: boolean },
    ): string;
  }
}
