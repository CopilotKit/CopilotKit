import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/skins/exec/data/store";
import { POST } from "./route";

beforeEach(() => store.reset());

describe("POST /api/exec/v1/packs", () => {
  it("POST packs surfaces the gate as 422 UNEXPLAINED_VARIANCE", async () => {
    const res = await POST(
      new Request("http://t/api/exec/v1/packs", {
        method: "POST",
        body: JSON.stringify({
          dashboardId: "cfo",
          countersignPin: store.COUNTERSIGN_PIN,
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("UNEXPLAINED_VARIANCE");
    expect(body.breaches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "opex",
          department: "distribution",
        }),
      ]),
    );
  });

  it("refuses a wrong countersign PIN before checking variance (403 BAD_COUNTERSIGN)", async () => {
    const res = await POST(
      new Request("http://t/api/exec/v1/packs", {
        method: "POST",
        body: JSON.stringify({
          dashboardId: "cfo",
          countersignPin: "0000",
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("BAD_COUNTERSIGN");
  });
});
