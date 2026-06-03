import PocketBase from "pocketbase";
import { getRuntimeConfig } from "./runtime-config.client";

// Lazy PocketBase client. The URL is read from the runtime config the
// FIRST time `getPb()` is called — not at module import. This is what
// makes one built artifact serve different PB hosts across staging vs
// prod: the runtime config is populated by the root layout's inline
// <script> before any client component calls `getPb()`.

/** Human-readable error surfaced to hooks when the runtime URL is the prod sentinel. */
export const PB_MISCONFIG_MESSAGE =
  "Dashboard misconfigured: POCKETBASE_URL was unset at runtime on this " +
  "deploy, so the app cannot reach PocketBase. Set the env var on the " +
  "Railway service.";

const PROD_INVALID_URL = "http://pocketbase.invalid";

let cachedClient: PocketBase | null = null;
let cachedUrl: string | null = null;

/**
 * Returns the singleton `PocketBase` client, constructed on first call.
 * Subsequent calls return the same instance.
 *
 * Call sites: every consumer that previously imported `{ pb }` now
 * imports `{ getPb }` and calls `getPb()` once at the top of the
 * function / effect / hook. Returns the REAL PocketBase instance — no
 * Proxy — so `instanceof PocketBase`, detached methods, and
 * `this`-sensitive call chains all work without surprise.
 */
export function getPb(): PocketBase {
  if (cachedClient) return cachedClient;
  const url = getRuntimeConfig().pocketbaseUrl;
  cachedUrl = url;
  cachedClient = new PocketBase(url);
  return cachedClient;
}

/**
 * `true` iff the current runtime URL is the prod sentinel — hooks can
 * short-circuit with a clear misconfig error instead of waiting for a
 * DNS failure. Function form (not a const boolean) because the URL is
 * resolved lazily on first `getPb()` call; a module-load boolean would
 * have to snapshot at import time, which is exactly the bug this
 * refactor removes.
 */
export function pbIsMisconfigured(): boolean {
  if (cachedUrl === null) getPb();
  return cachedUrl === PROD_INVALID_URL;
}
