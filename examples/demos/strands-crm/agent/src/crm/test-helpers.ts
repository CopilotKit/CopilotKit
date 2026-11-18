import { CrmStore } from "./store.js";
import { initDb } from "./db.js";

/** Returns a fresh CrmStore backed by an in-memory DB seeded from scratch.
 *  Use in beforeEach to get test isolation without touching data/northstar.db. */
export function freshStore(): CrmStore {
  return new CrmStore(initDb(":memory:"));
}
