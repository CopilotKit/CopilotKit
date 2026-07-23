import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  scanIntegration,
  scanAll,
  partition,
  loadBaseline,
} from "../validate-shared-symlinks.js";

// A fixture under fixtures/shared-symlinks models the single-source erosion
// shape (see showcase/AGENTS.md "The single-source symlink mechanism"):
//   - good-symlink/tools         → symlink → shared/python/tools    → OK
//   - new-erosion/tools          → real DIR, NOT baselined          → NEW erosion (fail)
//   - baselined-erosion/tools    → real DIR, IS baselined           → known debt (pass)
//   - no-shared-dir/tools        → real FILE (not a dir)            → ignored (different bug)
//   - broken-symlink/tools       → symlink → missing target        → NEW erosion (broken-link)
//   - wrong-target-symlink/tools → symlink → shared/toolbox (wrong) → NEW erosion (wrong-target)
const FIXTURE_INTEGRATIONS = path.resolve(
  __dirname,
  "fixtures",
  "shared-symlinks",
  "integrations",
);

describe("single-source symlink erosion guard", () => {
  it("does NOT flag a proper symlink into shared/", () => {
    const erosions = scanIntegration(
      path.join(FIXTURE_INTEGRATIONS, "good-symlink"),
    );
    expect(erosions).toHaveLength(0);
  });

  it("flags a real directory where a symlink should be (erosion)", () => {
    const erosions = scanIntegration(
      path.join(FIXTURE_INTEGRATIONS, "new-erosion"),
    );
    expect(erosions).toHaveLength(1);
    expect(erosions[0].linkName).toBe("tools");
    expect(erosions[0].key).toBe("new-erosion/tools");
    expect(erosions[0].reason).toBe("real-dir");
  });

  it("flags a symlink pointing at the WRONG target (not the shared source)", () => {
    // The pre-fix guard treated ANY symlink as healthy; a link that resolves to
    // something other than shared/{python,typescript}/tools must be caught — a
    // copy could be reintroduced behind it just as invisibly as a real dir.
    const erosions = scanIntegration(
      path.join(FIXTURE_INTEGRATIONS, "wrong-target-symlink"),
    );
    expect(erosions).toHaveLength(1);
    expect(erosions[0].key).toBe("wrong-target-symlink/tools");
    expect(erosions[0].reason).toBe("wrong-target");
  });

  it("flags a broken (dangling) symlink as eroded, not healthy", () => {
    const erosions = scanIntegration(
      path.join(FIXTURE_INTEGRATIONS, "broken-symlink"),
    );
    expect(erosions).toHaveLength(1);
    expect(erosions[0].key).toBe("broken-symlink/tools");
    expect(erosions[0].reason).toBe("broken-link");
  });

  it("ignores a real FILE in the slot (only real dirs are shared slots)", () => {
    const erosions = scanIntegration(
      path.join(FIXTURE_INTEGRATIONS, "no-shared-dir"),
    );
    expect(erosions).toHaveLength(0);
  });

  it("scanAll finds every eroded dir across integrations, sorted by key", () => {
    const erosions = scanAll(FIXTURE_INTEGRATIONS);
    const keys = erosions.map((e) => e.key);
    expect(keys).toEqual([
      "baselined-erosion/tools",
      "broken-symlink/tools",
      "new-erosion/tools",
      "wrong-target-symlink/tools",
    ]);
  });

  it("partition passes a baselined erosion but FAILS the new ones", () => {
    const erosions = scanAll(FIXTURE_INTEGRATIONS);
    const baseline = new Set(["baselined-erosion/tools"]);
    const { fresh, baselinedHit, staleBaseline } = partition(
      erosions,
      baseline,
    );
    // broken/new/wrong-target are fresh (fail CI); baselined is grandfathered.
    expect(fresh.map((e) => e.key)).toEqual([
      "broken-symlink/tools",
      "new-erosion/tools",
      "wrong-target-symlink/tools",
    ]);
    expect(baselinedHit).toEqual(["baselined-erosion/tools"]);
    expect(staleBaseline).toEqual([]);
  });

  it("reports a stale baseline entry once its symlink is restored", () => {
    const erosions = scanAll(FIXTURE_INTEGRATIONS);
    // A key in the baseline that is no longer eroded → stale, should be removed
    // so the ratchet shrinks toward a fully-enforcing zero baseline.
    const baseline = new Set([
      "baselined-erosion/tools",
      "already-healed/tools",
    ]);
    const { fresh, staleBaseline } = partition(erosions, baseline);
    expect(staleBaseline).toEqual(["already-healed/tools"]);
    // the fresh set is unaffected by the stale entry.
    expect(fresh.map((e) => e.key)).toEqual([
      "broken-symlink/tools",
      "new-erosion/tools",
      "wrong-target-symlink/tools",
    ]);
  });

  it("throws (fails loud) on a malformed baseline instead of returning empty", () => {
    // A silent empty-set on parse failure would report every baselined dir as a
    // NEW erosion — masking real debt as a fresh regression.
    const bad = path.join(
      __dirname,
      "fixtures",
      "shared-symlinks",
      "baseline-malformed.json",
    );
    fs.writeFileSync(bad, "{ this is not valid json ");
    try {
      expect(() => loadBaseline(bad)).toThrow(/baseline is not valid JSON/);
    } finally {
      fs.rmSync(bad, { force: true });
    }
  });
});

describe("real repo baseline is a faithful snapshot of current erosion", () => {
  // Guards against the baseline drifting out of sync with reality: every
  // currently-eroded real dir in the repo must be baselined (so CI passes on
  // the pre-existing debt) and every baseline key must still be eroded (no
  // stale entries left after a restore). This is the check that turns the
  // guard fully-enforcing the moment the baseline reaches zero.
  it("baseline covers exactly the currently-eroded set (no fresh, no stale)", () => {
    const erosions = scanAll(); // real showcase/integrations
    const baseline = loadBaseline(); // real baseline file
    const { fresh, staleBaseline } = partition(erosions, baseline);
    expect(fresh).toEqual([]);
    expect(staleBaseline).toEqual([]);
  });
});
