import type { AlertStateRecord } from "../types/index.js";
import type { PbClient } from "./pb-client.js";

export interface AlertStateStore {
  get(ruleId: string, dedupeKey: string): Promise<AlertStateRecord | null>;
  record(
    ruleId: string,
    dedupeKey: string,
    fields: { at: string; hash: string; preview: string },
  ): Promise<void>;
  getSet(ruleId: string): Promise<{ hash: string | null; at: string | null }>;
  putSet(ruleId: string, hash: string, at: string): Promise<void>;
}

// PocketBase's filter DSL is a custom grammar, NOT JSON. `JSON.stringify`
// happens to produce a compatible single-token string literal for ASCII
// and printable-Unicode inputs, but keys containing control characters
// (\n, \t, \u0000..\u001F, etc.) would leak through and break the filter
// parse. Rather than rely on the callers to behave, we enforce a
// printable-Unicode dedupe key at write time — `\P{C}` is the Unicode
// complement of the Other/Control category, which includes all printable
// letters, digits, symbols, marks, punctuation, and emoji across every
// script, while still rejecting C0/C1 control characters and surrogate
// escapes. (F2.4: the previous `[\x20-\x7E]+` was ASCII-only and failed
// closed on any emoji or accented repo name, causing alerts to fire on
// every tick because the suppress lookup threw before comparing hashes.)
// A proper fix is a dedicated composite column + PB migration; this
// guard is the interim contract so today's build stays safe.
const SAFE_DEDUPE_KEY_RE = /^[\P{C}]+$/u;

function assertSafeKey(field: string, value: string): void {
  if (!SAFE_DEDUPE_KEY_RE.test(value)) {
    throw new Error(
      `alert-state-store: ${field} must be printable Unicode (no control chars) (got ${JSON.stringify(value.slice(0, 40))})`,
    );
  }
}

function filterFor(ruleId: string, dedupeKey: string): string {
  // Defense in depth (B9): callers (`get`, `record`) already run both
  // args through `assertSafeKey`, which rejects C0/C1 control characters
  // before we ever build a filter string. JSON.stringify then quotes the
  // value correctly for PB's current DSL. If PB's filter DSL ever gains
  // placeholder syntax (e.g. `${…}` interpolation) or changes its
  // escaping rules, the control-char rejection in `assertSafeKey` is the
  // belt-and-braces we fall back to — but the right long-term fix is a
  // PB-side parameterized filter API, not string-level escaping here.
  return `rule_id = ${JSON.stringify(ruleId)} && dedupe_key = ${JSON.stringify(dedupeKey)}`;
}

// PB returns a 400 with a code of "validation_not_unique" on unique-index
// violations. Shape of the error body varies across versions, so we match
// the string fragment rather than parsing JSON.
function isUniqueConstraintError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes("validation_not_unique") ||
    msg.includes("is not unique") ||
    /UNIQUE constraint failed/i.test(msg)
  );
}

export function createAlertStateStore(pb: PbClient): AlertStateStore {
  const store: AlertStateStore = {
    async get(ruleId, dedupeKey) {
      assertSafeKey("ruleId", ruleId);
      assertSafeKey("dedupeKey", dedupeKey);
      return pb.getFirst<AlertStateRecord>(
        "alert_state",
        filterFor(ruleId, dedupeKey),
      );
    },

    async record(ruleId, dedupeKey, fields) {
      assertSafeKey("ruleId", ruleId);
      assertSafeKey("dedupeKey", dedupeKey);
      const record = {
        rule_id: ruleId,
        dedupe_key: dedupeKey,
        last_alert_at: fields.at,
        last_alert_hash: fields.hash,
        payload_preview: fields.preview.slice(0, 500),
      };
      const existing = await pb.getFirst<AlertStateRecord>(
        "alert_state",
        filterFor(ruleId, dedupeKey),
      );
      if (existing?.id) {
        await pb.update("alert_state", existing.id, record);
        return;
      }
      try {
        await pb.create("alert_state", record);
      } catch (err) {
        // TOCTOU race: a concurrent record() for the same (ruleId,
        // dedupeKey) saw no row and both raced to create. The DB unique
        // index catches it — re-read and update rather than surfacing a
        // constraint violation to the caller.
        if (!isUniqueConstraintError(err)) throw err;
        const racer = await pb.getFirst<AlertStateRecord>(
          "alert_state",
          filterFor(ruleId, dedupeKey),
        );
        if (!racer?.id) {
          // The constraint fired but the row is gone — nothing we can do
          // that makes sense; propagate the original error.
          throw err;
        }
        await pb.update("alert_state", racer.id, record);
      }
    },

    async getSet(ruleId) {
      const existing = await store.get(ruleId, "__set__");
      return {
        hash: existing?.last_alert_hash ?? null,
        at: existing?.last_alert_at ?? null,
      };
    },

    async putSet(ruleId, hash, at) {
      await store.record(ruleId, "__set__", { at, hash, preview: "" });
    },
  };
  return store;
}
