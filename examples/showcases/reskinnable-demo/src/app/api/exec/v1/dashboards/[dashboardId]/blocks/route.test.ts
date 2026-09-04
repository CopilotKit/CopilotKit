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

const deleteBlock = (dashboardId: string, blockId: string) =>
  DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
    params: Promise.resolve({ dashboardId, blockId }),
  });

describe("dashboard blocks — add, reorder, remove", () => {
  it("round-trips a draft block onto and off of the CEO dashboard", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);

    const addRes = await addToDashboard("ceo", draft.id);
    expect(addRes.status).toBe(200);
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

    const deleteRes = await deleteBlock("ceo", draft.id);
    expect(deleteRes.status).toBe(200);
    ceoBlocks = store.snapshot().dashboards.ceo.blocks;
    expect(ceoBlocks.map((b) => b.id)).not.toContain(draft.id);
  });

  it("rejects an unknown dashboardId with 400", async () => {
    const draft = store.createDraftBlock(DRAFT_SPEC);
    const res = await addToDashboard("not-a-real-dashboard", draft.id);
    expect(res.status).toBe(400);
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
});
