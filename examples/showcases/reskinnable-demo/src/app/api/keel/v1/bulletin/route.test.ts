import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/keel/data/store";
import { FRESH_CITATIONS } from "@/skins/keel/data/bulletin-citations";
import { toAscii } from "@/shell/documents";

beforeEach(() => store.reset());

const call = (query = "") =>
  GET(new Request(`http://localhost/api/keel/v1/bulletin${query}`));

/**
 * The PDF's content stream is plain (uncompressed) text, so the document can be
 * read back as bytes. Folded through the SAME ASCII fold the writer applies, so
 * a ref containing an em dash is compared against what was actually drawn.
 */
const textOf = async (res: Response) =>
  Buffer.from(await res.arrayBuffer()).toString("latin1");

describe("GET /bulletin serves the document beat 3d ingests", () => {
  it("returns a PDF that is never cached", async () => {
    const res = await call("?space=privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toContain(
      "bulletin-privacy.pdf",
    );
  });

  it("defaults to a space rather than 404ing on an absent or blank lever", async () => {
    // `?space=` is the shape a cleared field produces and yields the EMPTY
    // string, which `??` would not have defaulted.
    for (const query of ["", "?space=", "?space=%20%20"]) {
      expect((await call(query)).status).toBe(200);
    }
  });

  it("404s a space the corpus does not have", async () => {
    expect((await call("?space=finance")).status).toBe(404);
    // A plain-object lookup would have resolved this one TRUTHY.
    expect((await call("?space=constructor")).status).toBe(404);
  });
});

describe("every listed document is scoped to the space requested", () => {
  it("cites the register's own refs for that space and no other space's", async () => {
    const text = await textOf(await call("?space=vendor"));
    const vendor = store.documents().filter((r) => r.space === "vendor");
    const others = store.documents().filter((r) => r.space !== "vendor");
    expect(vendor.length).toBeGreaterThan(0);
    for (const record of vendor) expect(text).toContain(toAscii(record.ref));
    for (const record of others)
      expect(
        text,
        `${record.ref} leaked into the vendor bulletin`,
      ).not.toContain(toAscii(record.ref));
  });

  it("carries the ONE ref the register does not — the proof it was read", async () => {
    const fresh = FRESH_CITATIONS.get("clinical");
    expect(fresh).toBeDefined();
    const text = await textOf(await call("?space=clinical"));
    expect(text).toContain(toAscii(fresh!.ref));
    expect(store.refsOnFile()).not.toContain(fresh!.ref);
  });

  it("states a required action for every document it lists", async () => {
    const text = await textOf(await call("?space=privacy"));
    const fresh = FRESH_CITATIONS.get("privacy");
    expect(text).toContain(toAscii(fresh!.requiredAction.slice(0, 40)));
  });
});

describe("what the bulletin must NOT say", () => {
  it("prints no revision label — currentRevision is the register's to settle", async () => {
    // An external regulator cannot know which revision Harbor Point has in
    // force. Printing one would hand the model the very field `POST /briefs`
    // exists to own, and the settlement would only ever confirm what the
    // document already said.
    const text = await textOf(await call("?space=privacy"));
    expect(text).not.toMatch(/Rev [A-Z]\b/);
  });

  it("reflects a live register, so a released revision cannot stale the citations", async () => {
    const before = await textOf(await call("?space=vendor"));
    expect(before).toContain("STD-045");
    // Nothing about a release removes a document from the register, so the ref
    // must survive — this pins that the route reads live rather than a snapshot
    // captured at module load.
    store.releaseRevision("third-party-risk", "Sam Okafor", "endorsed");
    expect(await textOf(await call("?space=vendor"))).toContain("STD-045");
  });
});
