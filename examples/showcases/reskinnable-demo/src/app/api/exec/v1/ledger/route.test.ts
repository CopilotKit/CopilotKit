import { beforeEach, expect, it } from "vitest";
import { buildBlockOps } from "@/skins/exec/blocks/build-block-ops";
import * as store from "@/skins/exec/data/store";
import type { BlockSpec } from "@/skins/exec/data/types";
import { GET } from "./route";

beforeEach(() => store.reset());

it("GET ledger returns dashboards with pinned ops per block", async () => {
  const body = await (await GET()).json();
  expect(Object.keys(body.dashboards).sort()).toEqual(["ceo", "cfo"]);
  const block = body.dashboards.ceo.blocks[0];
  expect(block.ops.length).toBeGreaterThan(0);
  expect(JSON.stringify(block.ops)).not.toContain("AddToDashboard");

  for (const dashboard of Object.values(body.dashboards) as {
    blocks: { ops: unknown[] }[];
  }[]) {
    expect(dashboard.blocks.length).toBeGreaterThan(0);
    for (const b of dashboard.blocks) expect(b.ops.length).toBeGreaterThan(0);
  }
  expect(JSON.stringify(body.dashboards)).not.toContain("AddToDashboard");
});

/**
 * The "not.toContain(AddToDashboard)" assertion above is only meaningful if
 * the component is emitted SOMEWHERE — otherwise it would keep passing after
 * the pin control was deleted outright. This pins both halves against the
 * SAME spec: unpinned ops carry the control, and the ledger's pinned ops for
 * that identical spec do not. `buildBlockOps` is imported directly for the
 * unpinned half because drafts are deliberately not exposed over HTTP.
 */
it("emits AddToDashboard for an UNPINNED build of the very spec the ledger serves pinned", async () => {
  const body = await (await GET()).json();
  const pinned = body.dashboards.ceo.blocks[0] as {
    id: string;
    spec: BlockSpec;
    ops: unknown[];
  };

  const unpinnedOps = buildBlockOps(pinned.spec, pinned.id);
  expect(JSON.stringify(unpinnedOps)).toContain("AddToDashboard");

  const pinnedOps = buildBlockOps(pinned.spec, pinned.id, { pinned: true });
  expect(JSON.stringify(pinnedOps)).not.toContain("AddToDashboard");
  // ...and what the route actually served matches the pinned build.
  expect(pinned.ops).toEqual(pinnedOps);
});

/**
 * The route spreads the whole snapshot and only re-maps `dashboards`. Every
 * consumer surface (readables, the CEO/CFO pages, the exception list) reads
 * one of the spread fields, so dropping the spread breaks them all at once
 * while `dashboards` keeps looking fine.
 */
it("serves the whole snapshot, not just dashboards", async () => {
  const body = await (await GET()).json();

  expect(body.metricDefs.length).toBeGreaterThan(0);
  expect(body.metricDefs[0]).toMatchObject({
    id: expect.any(String),
    label: expect.any(String),
    unit: expect.any(String),
    thresholdPct: expect.any(Number),
    byDepartment: expect.any(Boolean),
  });

  expect(body.exceptions.length).toBeGreaterThan(0);
  expect(body.exceptions[0]).toMatchObject({
    metricId: expect.any(String),
    period: expect.any(String),
    department: expect.any(String),
    variancePct: expect.any(Number),
    explained: expect.any(Boolean),
  });
  expect(body.exceptions).toEqual(store.snapshot().exceptions);

  expect(body.dashboards.ceo).toMatchObject({
    id: "ceo",
    title: expect.any(String),
  });
  expect(body.points.length).toBeGreaterThan(0);
  expect(body.initiatives.length).toBeGreaterThan(0);
  expect(body.narratives).toEqual([]);
  expect(body.packs).toEqual([]);
});

/**
 * The ledger is a live read of a mutating store: every filing, pin, unpin and
 * publish changes it, and the CEO/CFO pages re-fetch after each one. A cached
 * copy — Next's route-handler cache, a CDN in front of a booth deploy, or a
 * browser heuristic on a header-less 200 — serves the PRE-mutation snapshot,
 * which on stage reads as "the pin didn't work". The client already asks with
 * `cache: "no-store"` (see `data/ledger-context.tsx`), but that governs only
 * the browser's own cache; the response has to say so too, exactly as this
 * skin's budget-memo route already does.
 */
it("serves the ledger no-store, so no layer can hand back a pre-mutation snapshot", async () => {
  const res = await GET();
  expect(res.headers.get("cache-control")).toBe("no-store");
});

/**
 * The narrative CODE stays in this response, deliberately — do not "harden"
 * it out. Beat 6's filed-narratives list (`pages/board-packs.tsx`'s
 * `FiledNarrativesList`) renders `NARRATIVE_CODE_LABELS[n.code]` off this very
 * snapshot, and the filing form on the same page ships all four codes to the
 * browser in its `<select>` anyway, so stripping the field here buys no
 * secrecy and blanks a label a human reads.
 *
 * The withheld-vocabulary boundary is AGENT CHANNELS, not the browser: the
 * page's readable lists narratives by metric and period only, `agent.ts`'s
 * tools never echo a code, and the narratives route's BAD_CODE refusal names
 * none. This pins where the line actually is so a future pass moves it
 * knowingly rather than by grep.
 */
it("keeps the narrative code in the snapshot the board-packs list renders from", async () => {
  const [breach] = store.exceptions().filter((e) => !e.explained);
  const filed = store.fileNarrative({
    metricId: breach.metricId,
    period: breach.period,
    code: "VAR-TIMING",
    body: "Shipment timing shift pushed the spend into this period.",
    source: "typed",
  });

  const body = await (await GET()).json();
  expect(body.narratives).toHaveLength(1);
  expect(body.narratives[0]).toMatchObject({
    id: filed.id,
    metricId: breach.metricId,
    period: breach.period,
    code: "VAR-TIMING",
    source: "typed",
  });
});

/**
 * A draft block is UNPINNED — invisible to the dashboard pages until someone
 * pins it. That separation is asserted in the store's own tests; this asserts
 * it survives the HTTP boundary, where a leak would render the block on the
 * dashboard the moment the agent called `render_metric_block`.
 */
it("excludes drafts from the ledger response until they are pinned", async () => {
  const spec: BlockSpec = {
    kind: "metricTile",
    title: "Unpinned Draft Tile",
    metricId: "nps",
    department: "all",
  };
  const draft = store.createDraftBlock(spec);

  const before = await (await GET()).text();
  expect(before).not.toContain(draft.id);
  expect(before).not.toContain(spec.title);

  // Pinning is the only thing that makes it visible here.
  store.addBlockToDashboard("ceo", draft.id);
  const after = await (await GET()).text();
  expect(after).toContain(draft.id);
  expect(after).toContain(spec.title);
});
