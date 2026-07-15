import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallId } from "./install-id.js";
import { MemoryStore } from "../state/memory-store.js";
import type { StateStore } from "../state/state-store.js";

class FakeDurableStore implements StateStore {
  map = new Map<string, unknown>();
  kv = {
    get: async <T>(k: string) => this.map.get(k) as T | undefined,
    set: async <T>(k: string, v: T) => void this.map.set(k, v),
    delete: async (k: string) => void this.map.delete(k),
  };
  list = {} as StateStore["list"];
  lock = {} as StateStore["lock"];
  dedup = {} as StateStore["dedup"];
  queue = {} as StateStore["queue"];
}

describe("resolveInstallId", () => {
  it("persists + reuses in a durable store", async () => {
    const backend = new FakeDurableStore();
    const a = await resolveInstallId({ backend });
    const b = await resolveInstallId({ backend });
    expect(a).toBe(b);
    expect(backend.map.get("cpk:telemetry:install_id")).toBe(a);
  });
  it("persists + reuses in a file for MemoryStore", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "cpk-"));
    const backend = new MemoryStore();
    const a = await resolveInstallId({ backend, cacheDir });
    const b = await resolveInstallId({ backend, cacheDir });
    expect(a).toBe(b);
  });
  it("falls back to a uuid when the file dir is unwritable", async () => {
    const backend = new MemoryStore();
    const id = await resolveInstallId({
      backend,
      cacheDir: "/dev/null/nope",
      uuid: () => "FALLBACK",
    });
    expect(id).toBe("FALLBACK");
  });
});
