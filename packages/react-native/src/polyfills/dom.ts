/**
 * Polyfill: DOMException, Headers
 *
 * DOMException is used by CopilotKit's isAbortError check.
 * Headers is used by CopilotKit's request construction.
 * Skipped if the globals are already defined.
 *
 * Usage:
 *   import "@copilotkit/react-native/polyfills/dom";
 */

// DOMException
if (typeof (globalThis as any).DOMException === "undefined") {
  class DOMExceptionPolyfill extends Error {
    code: number;
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name || "DOMException";
      this.code = 0;
    }
  }
  (globalThis as any).DOMException = DOMExceptionPolyfill;
}

// Headers
if (typeof (globalThis as any).Headers === "undefined") {
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
    append(name: string, value: string): void {
      const key = name.toLowerCase();
      if (key in this._map) {
        this._map[key] += ", " + value;
      } else {
        this._map[key] = value;
      }
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
    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries();
    }
  }
  (globalThis as any).Headers = HeadersPolyfill;
}
