import { beforeEach, expect, it } from "vitest";
import * as store from "@/skins/exec/data/store";
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
