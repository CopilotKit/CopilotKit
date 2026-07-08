import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../state/memory-store.js";
import type { StateStore } from "../state/state-store.js";

const STORE_KEY = "cpk:telemetry:install_id";
const FILE_NAME = "telemetry-id";
const defaultUuid = () => globalThis.crypto.randomUUID();
const defaultCacheDir = () =>
  join(process.cwd(), "node_modules", ".cache", "copilotkit");

export interface ResolveInstallIdDeps {
  backend: StateStore;
  cacheDir?: string;
  uuid?: () => string;
}

export async function resolveInstallId(
  deps: ResolveInstallIdDeps,
): Promise<string> {
  const uuid = deps.uuid ?? defaultUuid;
  if (!(deps.backend instanceof MemoryStore)) {
    try {
      const existing = await deps.backend.kv.get<string>(STORE_KEY);
      if (existing) return existing;
      const id = uuid();
      await deps.backend.kv.set(STORE_KEY, id);
      return id;
    } catch {
      /* fall through */
    }
  }
  try {
    const dir = deps.cacheDir ?? defaultCacheDir();
    const file = join(dir, FILE_NAME);
    try {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) return existing;
    } catch {
      /* not created yet */
    }
    mkdirSync(dir, { recursive: true });
    const id = uuid();
    writeFileSync(file, id, "utf8");
    return id;
  } catch {
    /* fall through */
  }
  return uuid();
}
