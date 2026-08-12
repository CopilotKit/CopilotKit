import { describe, it, expect } from "vitest";
import { DIMENSIONS } from "./index.js";
import type { Logger, StatusRecord, ProbeState } from "./index.js";
import type { PbClient } from "../storage/pb-client.js";
import type { TypedEventBus } from "../events/event-bus.js";
import { createStatusWriter } from "../writers/status-writer.js";

describe("DIMENSIONS", () => {
  it("contains e2e_d6 for the D6 probe kind", () => {
    expect(DIMENSIONS).toContain("e2e_d6");
  });

  it("contains d6 for D6 side-row dimension", () => {
    expect(DIMENSIONS).toContain("d6");
  });

  it("contains e2e-demos (hyphen) for the d3-readiness aggregate emit prefix", () => {
    // The driver emits aggregate rows under `e2e-demos:<slug>` (see
    // config/probes/e2e-demos.yml key_template); deriveDimension() takes
    // the before-colon prefix, so persisted rows carry "e2e-demos".
    expect(DIMENSIONS).toContain("e2e-demos");
  });

  it("contains e2e_demos (underscore) for the probe kind literal", () => {
    expect(DIMENSIONS).toContain("e2e_demos");
  });

  it("pins the load-bearing kind/emit-prefix pairs (both members of DIMENSIONS)", () => {
    const pairs: Array<[kind: string, emit: string]> = [
      ["e2e_demos", "e2e-demos"],
      ["e2e_d6", "d6"],
      ["starter_smoke", "starter"],
    ];
    for (const [kind, emit] of pairs) {
      expect(DIMENSIONS).toContain(kind);
      expect(DIMENSIONS).toContain(emit);
    }
  });
});

/**
 * B6 (round 6): the dimension-derivation contract is asserted through the
 * REAL status-writer over a fake PB — the previous version of this file
 * tested a LOCAL reimplementation of the before-colon split, which pinned
 * nothing (the copy could drift from `deriveDimensionWithWarn` and these
 * tests would keep passing). What matters is the PERSISTED `dimension`
 * column on the status row the dashboard reads, so that is what is asserted.
 */
describe("persisted dimension derivation (real status-writer over fake PB)", () => {
  /**
   * Minimal fake PB modelling exactly the durable-write path the
   * status-writer takes: getFirst (prior-row read) → create (status_history)
   * → upsertByField (status). Rows are keyed by `key`.
   */
  function makeFakePb(): {
    pb: PbClient;
    rows: Map<string, StatusRecord>;
    history: Record<string, unknown>[];
  } {
    const rows = new Map<string, StatusRecord>();
    const history: Record<string, unknown>[] = [];
    let nextRowId = 0;
    const unsupported = (n: string) => () => {
      throw new Error(`fake-pb: ${n} not implemented`);
    };
    const pb: PbClient = {
      async getFirst<T>(collection: string, filter: string): Promise<T | null> {
        if (collection !== "status") return null;
        // Round-8 #8c: the writer's filter is `key = ${JSON.stringify(key)}`,
        // so the quoted segment may carry JSON escapes (\" etc.) — recover
        // the key by JSON.parsing it rather than a naive `([^"]*)` capture
        // (which can't match an escaped quote). Still fail-loud on any
        // filter shape this fake can't evaluate.
        const match = filter.match(/^key = (".*")$/s);
        if (!match) {
          throw new Error(`fake-pb.getFirst: unrecognized filter: ${filter}`);
        }
        let key: string;
        try {
          key = JSON.parse(match[1]!) as string;
        } catch {
          throw new Error(
            `fake-pb.getFirst: unparseable quoted key segment: ${filter}`,
          );
        }
        return (rows.get(key) as unknown as T) ?? null;
      },
      async create<T>(
        collection: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        if (collection === "status") {
          const r = record as unknown as StatusRecord;
          // Round-9 #8d: monotonic — `r-${rows.size + 1}` re-issued an
          // existing id after any row deletion.
          rows.set(r.key, { ...r, id: `r-${++nextRowId}` });
          return rows.get(r.key) as unknown as T;
        }
        history.push(record);
        return record as unknown as T;
      },
      async update<T>(
        _collection: string,
        id: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        const existing = [...rows.values()].find((r) => r.id === id);
        if (existing) {
          const merged = { ...existing, ...(record as Partial<StatusRecord>) };
          rows.set(merged.key, merged);
          return merged as unknown as T;
        }
        // Round-9 #8c: real PB 404s an update against a missing row —
        // resolving with the record fabricated success and made the fake
        // immune to TOCTOU-class writer bugs.
        throw Object.assign(new Error("The requested resource wasn't found."), {
          statusCode: 404,
          data: {},
        });
      },
      async upsertByField<T>(
        collection: string,
        field: string,
        value: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        const existing = await pb.getFirst<StatusRecord>(
          collection,
          `${field} = ${JSON.stringify(value)}`,
        );
        if (existing?.id) {
          return pb.update<T>(collection, existing.id, record);
        }
        return pb.create<T>(collection, { ...record, [field]: value });
      },
      getOne: unsupported("getOne") as PbClient["getOne"],
      list: unsupported("list") as PbClient["list"],
      delete: unsupported("delete") as PbClient["delete"],
      deleteByFilter: unsupported(
        "deleteByFilter",
      ) as PbClient["deleteByFilter"],
      health: unsupported("health") as PbClient["health"],
      createBackup: unsupported("createBackup") as PbClient["createBackup"],
      downloadBackup: unsupported(
        "downloadBackup",
      ) as PbClient["downloadBackup"],
      deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
    };
    return { pb, rows, history };
  }

  function makeWriterHarness(): {
    write: (key: string, state?: ProbeState) => Promise<void>;
    rows: Map<string, StatusRecord>;
    history: Record<string, unknown>[];
    warns: { msg: string; ctx?: Record<string, unknown> }[];
  } {
    const { pb, rows, history } = makeFakePb();
    const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
      info() {},
      error() {},
      debug() {},
      warn(msg: string, ctx?: Record<string, unknown>) {
        warns.push({ msg, ctx });
      },
    };
    const noopBus: TypedEventBus = {
      emit: () => {},
      on: () => () => {},
      removeAll: () => {},
    };
    const writer = createStatusWriter({
      pb,
      bus: noopBus,
      logger,
      writtenBy: "cli",
    });
    return {
      rows,
      history,
      warns,
      // Round-8 #8d: ProbeResult.state IS ProbeState — no cast needed (the
      // previous `state as State` was a wrong-direction narrowing that
      // lied about "error" inputs).
      write: async (key, state: ProbeState = "green") =>
        void (await writer.write({
          key,
          state,
          signal: { ok: true },
          observedAt: "2026-06-04T00:00:00.000Z",
        })),
    };
  }

  it("persists dimension 'e2e-demos' (the hyphen emit prefix) for an e2e-demos aggregate key", async () => {
    const h = makeWriterHarness();
    await h.write("e2e-demos:x");
    expect(h.rows.get("e2e-demos:x")?.dimension).toBe("e2e-demos");
    expect(DIMENSIONS).toContain(h.rows.get("e2e-demos:x")!.dimension);
  });

  it("persists the emit-prefix dimension for representative emitted keys (d6 side row, starter row)", async () => {
    const h = makeWriterHarness();
    await h.write("d6:langgraph-python/shared-state");
    await h.write("starter:langgraph-python/agent");
    expect(h.rows.get("d6:langgraph-python/shared-state")?.dimension).toBe(
      "d6",
    );
    expect(h.rows.get("starter:langgraph-python/agent")?.dimension).toBe(
      "starter",
    );
    expect(DIMENSIONS).toContain("d6");
    expect(DIMENSIONS).toContain("starter");
  });

  it("persists dimension 'unknown' for a colonless key (and warns malformed-key)", async () => {
    const h = makeWriterHarness();
    await h.write("no-colon-key");
    expect(h.rows.get("no-colon-key")?.dimension).toBe("unknown");
    expect(
      h.warns.filter((w) => w.msg === "status-writer.malformed-key"),
    ).toHaveLength(1);
  });

  it("persists dimension 'unknown' for an empty-prefix (leading-colon) key", async () => {
    const h = makeWriterHarness();
    await h.write(":leading-colon");
    expect(h.rows.get(":leading-colon")?.dimension).toBe("unknown");
  });

  it("handles keys whose filter literal needs JSON escapes (embedded double-quote) (round-8 #8c)", async () => {
    // Red-green (round-8 #8c): the writer builds its filter as
    // `key = ${JSON.stringify(key)}`, so a key containing a double-quote
    // arrives JSON-escaped — the old `^key = "([^"]*)"$` regex could not
    // match it and the fake threw "unrecognized filter" for a perfectly
    // well-formed filter. The fake now JSON.parses the quoted segment.
    const h = makeWriterHarness();
    const key = 'e2e-demos:has"quote';
    await h.write(key);
    expect(h.rows.get(key)?.dimension).toBe("e2e-demos");
  });

  it("stamps the SAME derived dimension on the status_history row", async () => {
    const h = makeWriterHarness();
    await h.write("e2e-demos:x");
    expect(h.history).toHaveLength(1);
    expect(h.history[0]!.dimension).toBe("e2e-demos");
  });

  it("fake-pb update rejects 404-shaped for unknown ids instead of fabricating success (round-9 #8c)", async () => {
    // Real PB 404s an update against a missing row; silently resolving made
    // the fake immune to TOCTOU-class writer bugs.
    const { pb } = makeFakePb();
    await expect(
      pb.update("status", "no-such-id", { signal: {} }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("fake-pb create ids stay unique after a row delete (round-9 #8d)", async () => {
    // `r-${rows.size + 1}` re-issues an existing id after any delete; the
    // counter must be monotonic.
    const { pb, rows } = makeFakePb();
    await pb.create("status", { key: "smoke:a" });
    const b = (await pb.create("status", {
      key: "smoke:b",
    })) as StatusRecord;
    rows.delete("smoke:a");
    const c = (await pb.create("status", {
      key: "smoke:c",
    })) as StatusRecord;
    expect(c.id).not.toBe(b.id);
  });
});
