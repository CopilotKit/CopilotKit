import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { GET as getKpis } from "@/app/api/vantage/v1/kpis/route";
import { GET as getSeries } from "@/app/api/vantage/v1/series/route";
import {
  GET as getBoards,
  POST as postBoard,
} from "@/app/api/vantage/v1/boards/route";
import { POST as postSource } from "@/app/api/vantage/v1/sources/route";
import { DEFAULT_LENS } from "./lens";
import { DEFAULT_KPIS } from "./derive";

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe("vantage REST", () => {
  beforeEach(() => store.reset());

  it("GET /kpis honours the lens in the query string", async () => {
    const all = await (
      await getKpis(req("http://t/api/vantage/v1/kpis"))
    ).json();
    const emea = await (
      await getKpis(req("http://t/api/vantage/v1/kpis?region=emea"))
    ).json();
    expect(all.lens.region).toBe("all");
    expect(emea.lens.region).toBe("emea");
    const arrAll = all.kpis.find(
      (k: { metric: string }) => k.metric === "arr",
    ).value;
    const arrEmea = emea.kpis.find(
      (k: { metric: string }) => k.metric === "arr",
    ).value;
    expect(arrEmea).toBeLessThan(arrAll);
  });

  it("GET /kpis returns the four default KPIs when no metrics are asked for", async () => {
    const body = await (
      await getKpis(req("http://t/api/vantage/v1/kpis"))
    ).json();
    expect(body.kpis.map((k: { metric: string }) => k.metric)).toEqual(
      DEFAULT_KPIS,
    );
  });

  it("GET /kpis?metrics=… returns metrics outside the default four", async () => {
    const body = await (
      await getKpis(
        req("http://t/api/vantage/v1/kpis?metrics=nrr,magic_number"),
      )
    ).json();
    expect(body.kpis.map((k: { metric: string }) => k.metric)).toEqual([
      "nrr",
      "magic_number",
    ]);
    const nrr = body.kpis.find((k: { metric: string }) => k.metric === "nrr");
    expect(nrr.value).toBeGreaterThan(0);
  });

  it("GET /kpis ignores unknown metric ids and falls back when none remain", async () => {
    const body = await (
      await getKpis(
        req("http://t/api/vantage/v1/kpis?metrics=nrr,not_a_metric"),
      )
    ).json();
    expect(body.kpis.map((k: { metric: string }) => k.metric)).toEqual(["nrr"]);

    const empty = await (
      await getKpis(req("http://t/api/vantage/v1/kpis?metrics=not_a_metric"))
    ).json();
    expect(empty.kpis.map((k: { metric: string }) => k.metric)).toEqual(
      DEFAULT_KPIS,
    );
  });

  it("GET /series returns the series, the breakdown and the waterfall together", async () => {
    const body = await (
      await getSeries(
        req("http://t/api/vantage/v1/series?metric=arr&dimension=region"),
      )
    ).json();
    expect(body.series.metric).toBe("arr");
    expect(body.breakdown).toHaveLength(3);
    expect(body.waterfall.some((s: { kind: string }) => s.kind === "end")).toBe(
      true,
    );
  });

  it("POST /boards files a board that GET /boards then lists", async () => {
    const res = await postBoard(
      req("http://t/api/vantage/v1/boards", {
        method: "POST",
        body: JSON.stringify({
          title: "Monday exec review",
          summary: "from the deck",
          lens: DEFAULT_LENS,
          tiles: [{ kind: "kpi", metric: "arr", label: "ARR" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const { board } = await res.json();
    const listed = await (await getBoards()).json();
    expect(listed.boards.map((b: { id: string }) => b.id)).toContain(board.id);
  });

  it("POST /boards rejects a body with no tiles", async () => {
    const res = await postBoard(
      req("http://t/api/vantage/v1/boards", {
        method: "POST",
        body: JSON.stringify({
          title: "Empty",
          summary: "",
          lens: DEFAULT_LENS,
          tiles: [],
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("POST /sources NEVER echoes the token back", async () => {
    const res = await postSource(
      req("http://t/api/vantage/v1/sources", {
        method: "POST",
        body: JSON.stringify({
          name: "GROWTH_PROD",
          warehouse: "BigQuery",
          token: "super-secret-token-value",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("super-secret-token-value");
    expect(raw).not.toContain("token");
  });

  it("POST /sources rejects an implausibly short token without storing anything", async () => {
    const before = store.sources().length;
    const res = await postSource(
      req("http://t/api/vantage/v1/sources", {
        method: "POST",
        body: JSON.stringify({
          name: "X",
          warehouse: "Snowflake",
          token: "abc",
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(store.sources()).toHaveLength(before);
  });
});
