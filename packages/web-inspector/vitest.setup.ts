// Node 22.4+ ships an experimental built-in `localStorage` global that is
// installed before vitest's jsdom environment runs, leaving `window.localStorage`
// as an uninitialized stub (no `getItem`/`setItem`/`clear` methods). Replace it
// with a minimal in-memory Storage shim so telemetry persistence tests behave
// the same on Node 18/20/22/25+ without depending on `--no-experimental-webstorage`.

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}
