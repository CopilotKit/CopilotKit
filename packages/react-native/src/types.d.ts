// React Native global provided by Metro bundler
declare const __DEV__: boolean;

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
