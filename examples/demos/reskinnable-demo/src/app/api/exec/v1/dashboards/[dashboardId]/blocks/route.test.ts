import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import { DELETE, PATCH } from "./[blockId]/route";
import * as store from "@/skins/exec/data/store";
import type { BlockSpec } from "@/skins/exec/data/types";

beforeEach(() => store.reset());

const DRAFT_SPEC: BlockSpec = {
  kind: "metricTile",
  title: "New Block",
  metricId: "nps",
  department: "all",
};

const addToDashboard = (dashboardId: string, blockId: string) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({ blockId }),
    }),
    { params: Promise.resolve({ dashboardId }) },
  );

const patchBlock = (dashboardId: string, blockId: string, body: unknown) =>
  PATCH(
    new Request("http://localhost/x", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ dashboardId, blockId }) },
  );

/** The ids currently pinned to a dashboard, read fresh out of the store. */
const pinnedIds = (dashboardId: "ceo" | "cfo") =>
  store.snapshot().dashboards[dashboardId].blocks.map((b) => b.id);

const deleteBlock = (dashboardId: string, blockId: string) =>
  DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
    params: Promise.resolve({ dashboardId, blockId }),
  });

describe("dashboard blocks — add, reorder, remove", () => {
  /**
   * The RESPONSE BODIES, not just the statuses and the store.
   *
   * The grid re-renders from what these three handlers return (see
   * `data/ledger-context.tsx`), so a handler that mutated correctly and then
   * answered with the wrong thing — the pre-mutation list, the other
   * dashboard's list, `undefined` — leaves a stale or empty dashboard on
   * screen while every store assertion in this file still passes. Each shape
   * is deliberate and different: POST answers with the ONE block it pinned
   * (the agent needs its id back), DELETE and PATCH with the dashboard's whole
   * block list in its new order (the grid redraws from it).
   */
  it("round-trips a draft block onto and off of the CEO dashboard", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);

    const addRes = await addToDashboard("ceo", draft.id);
    expect(addRes.status).toBe(200);
    // The pinned block itself, echoed back whole — id and spec, so the caller
    // that only has a draft id can render it without a second read.
    expect(await addRes.json()).toEqual({
      id: draft.id,
      spec: DRAFT_SPEC,
      addedAt: expect.any(String),
    });
    let ceoBlocks = store.snapshot().dashboards.ceo.blocks;
    expect(ceoBlocks.map((b) => b.id)).toContain(draft.id);
    const addedIndex = ceoBlocks.findIndex((b) => b.id === draft.id);
    // The seed CEO dashboard ships with more than one block, so "up" has
    // somewhere to go — this asserts the swap actually moved something
    // rather than merely no-oping at the top of the list.
    expect(addedIndex).toBeGreaterThan(0);

    const patchRes = await patchBlock("ceo", draft.id, { direction: "up" });
    expect(patchRes.status).toBe(200);
    ceoBlocks = store.snapshot().dashboards.ceo.blocks;
    const movedIndex = ceoBlocks.findIndex((b) => b.id === draft.id);
    expect(movedIndex).toBe(addedIndex - 1);
    // The POST-MOVE list, in the new order: the grid draws the order it is
    // handed, so answering with the pre-move list puts the block back where
    // it was until the next full ledger read.
    const patched = (await patchRes.json()) as { id: string }[];
    expect(patched.map((b) => b.id)).toEqual(ceoBlocks.map((b) => b.id));
    expect(patched[movedIndex].id).toBe(draft.id);

    const deleteRes = await deleteBlock("ceo", draft.id);
    expect(deleteRes.status).toBe(200);
    ceoBlocks = store.snapshot().dashboards.ceo.blocks;
    expect(ceoBlocks.map((b) => b.id)).not.toContain(draft.id);
    // The list WITHOUT the unpinned block — the untouched list here is what a
    // failed unpin used to look like, and it is indistinguishable from success
    // to the grid.
    const remaining = (await deleteRes.json()) as { id: string }[];
    expect(remaining.map((b) => b.id)).toEqual(ceoBlocks.map((b) => b.id));
    expect(remaining.map((b) => b.id)).not.toContain(draft.id);
  });

  /**
   * DELETE and PATCH answer with the TARGET dashboard's blocks. Serving the
   * other one's (or both merged) redraws the CFO grid over the CEO's, which is
   * a store-invisible bug: every assertion about `snapshot()` still passes.
   */
  it("answers DELETE and PATCH with the target dashboard's blocks only", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);
    await addToDashboard("cfo", draft.id);

    const ceoIds = pinnedIds("ceo");

    const patched = (await (
      await patchBlock("cfo", draft.id, { direction: "up" })
    ).json()) as { id: string }[];
    expect(patched.map((b) => b.id)).toEqual(pinnedIds("cfo"));
    for (const id of ceoIds) expect(patched.map((b) => b.id)).not.toContain(id);

    const deleted = (await (await deleteBlock("cfo", draft.id)).json()) as {
      id: string;
    }[];
    expect(deleted.map((b) => b.id)).toEqual(pinnedIds("cfo"));
    for (const id of ceoIds) expect(deleted.map((b) => b.id)).not.toContain(id);
  });

  it("rejects an unknown dashboardId with 400", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);
    const res = await addToDashboard("not-a-real-dashboard", draft.id);
    expect(res.status).toBe(400);
  });

  /**
   * `state.dashboards[dashboardId]` is a plain object index, so an unvalidated
   * dashboardId does not fall through to a coded refusal — it throws reading
   * `.blocks` off `undefined`, which surfaces as an opaque 500 with a stack
   * trace. DELETE and PATCH need the same param guard the POST has; only the
   * POST's was covered.
   *
   * The exact status is deliberately not pinned here (400 today; the store may
   * grow a NOT_FOUND arm) — what must hold is that the handler RESOLVES with a
   * non-2xx rather than throwing, and leaves the dashboards untouched.
   */
  it("refuses DELETE and PATCH for an unknown dashboardId without throwing", async () => {
    const before = JSON.stringify(store.snapshot().dashboards);
    const seeded = store.snapshot().dashboards.ceo.blocks[0];

    for (const res of [
      await deleteBlock("not-a-real-dashboard", seeded.id),
      await patchBlock("not-a-real-dashboard", seeded.id, { direction: "up" }),
    ]) {
      expect(res.ok).toBe(false);
      expect(res.status).toBeGreaterThanOrEqual(400);
      // A refusal, not an empty body the caller has to guess at.
      expect((await res.json()).error).toEqual(expect.any(String));
    }

    expect(JSON.stringify(store.snapshot().dashboards)).toBe(before);
  });

  it("rejects a malformed POST body with 400", async () => {
    const badBodies = [
      "{ not json",
      JSON.stringify({}),
      JSON.stringify({ blockId: 42 }),
      JSON.stringify({ blokcId: "typo" }),
    ];
    for (const body of badBodies) {
      const res = await POST(
        new Request("http://localhost/x", { method: "POST", body }),
        { params: Promise.resolve({ dashboardId: "ceo" }) },
      );
      expect(res.status, body).toBe(400);
      expect((await res.json()).error).toBe("BAD_REQUEST");
    }
  });

  it("404s NOT_FOUND for a blockId with no draft behind it", async () => {
    // The shape a hallucinated id from `pinBlockToDashboard` takes. Without
    // the route's own catch this is a thrown 500 with a stack trace, which
    // reaches the agent as an opaque failure and gets retried identically.
    const res = await addToDashboard("ceo", "block-does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
    // The message names the id, so a presenter can tell a bad id from a
    // broken route.
    expect(body.message).toContain("block-does-not-exist");
  });

  it("rejects a bogus direction with 400", async () => {
    const seeded = store.snapshot().dashboards.ceo.blocks[0];
    const res = await patchBlock("ceo", seeded.id, { direction: "sideways" });
    expect(res.status).toBe(400);
  });

  /**
   * A failed unpin must not read as a successful one. These used to answer
   * 200 with the untouched block list, which is indistinguishable from
   * "removed it" to both the grid and the agent — and inconsistent with the
   * POST on the same resource, which already 404s an unknown blockId.
   */
  it("404s NOT_FOUND when DELETEing a blockId that is not on the dashboard", async () => {
    const res = await deleteBlock("ceo", "block-does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toContain("block-does-not-exist");
  });

  it("404s NOT_FOUND when PATCHing a blockId that is not on the dashboard", async () => {
    const res = await patchBlock("ceo", "block-does-not-exist", {
      direction: "up",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("NOT_FOUND");
    expect(body.message).toContain("block-does-not-exist");
  });

  it("404s a DELETE aimed at the dashboard that does NOT hold the block", async () => {
    const cfoBlock = store.snapshot().dashboards.cfo.blocks[0];
    const res = await deleteBlock("ceo", cfoBlock.id);
    expect(res.status).toBe(404);
    expect(store.snapshot().dashboards.cfo.blocks.map((b) => b.id)).toContain(
      cfoBlock.id,
    );
  });

  /**
   * Unpin then re-pin, over HTTP, is the sequence the chat's still-visible pin
   * control performs. It has to succeed — the DELETE returns the block to
   * drafts rather than destroying it.
   */
  it("re-pins a block through POST after it was unpinned through DELETE", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);
    expect((await addToDashboard("ceo", draft.id)).status).toBe(200);
    expect((await deleteBlock("ceo", draft.id)).status).toBe(200);

    const repin = await addToDashboard("cfo", draft.id);
    expect(repin.status).toBe(200);
    expect(store.snapshot().dashboards.cfo.blocks.map((b) => b.id)).toContain(
      draft.id,
    );
  });

  /**
   * Single-home is deliberate, but the POST has to say so honestly: 409
   * ALREADY_PINNED naming the holding dashboard, never 404 "no draft" —
   * which tells the agent to re-render and duplicate the block.
   */
  it("409s ALREADY_PINNED when pinning a block held by the other dashboard", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);
    await addToDashboard("ceo", draft.id);

    const res = await addToDashboard("cfo", draft.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ALREADY_PINNED");
    expect(body.message).toContain("ceo");
    expect(
      store.snapshot().dashboards.cfo.blocks.map((b) => b.id),
    ).not.toContain(draft.id);
  });
});
