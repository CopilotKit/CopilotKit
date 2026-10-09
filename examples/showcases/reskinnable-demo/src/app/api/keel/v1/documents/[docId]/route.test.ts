import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/keel/data/store";

beforeEach(() => store.reset());

const read = (docId: string) =>
  GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ docId }),
  });

describe("GET /documents/[docId] — the parameterized knowledge route", () => {
  it("returns the corpus prose AND the register row, joined server-side", () => {
    // Joined here so the two can never be fetched a moment apart, and so the
    // register never grows its own copy of the prose.
    return read("phi-access-policy").then(async (res) => {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.doc.ref).toBe("POL-114");
      expect(body.doc.sections.length).toBeGreaterThan(0);
      expect(body.record.pendingRevision.label).toBe("Rev D");
    });
  });

  it("serves the anchored sections a citation deep-links into", () => {
    return read("phi-access-policy").then(async (res) => {
      const body = await res.json();
      expect(body.doc.sections.map((s: { id: string }) => s.id)).toContain(
        "minimum-necessary",
      );
    });
  });

  it("404s a document the library does not carry", () => {
    return read("no-such-doc").then(async (res) => {
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("NOT_FOUND");
    });
  });

  it("returns record: null rather than 404 when only the overlay is missing", async () => {
    // The prose is the primary artifact; the lifecycle overlay is additive. A
    // 404 here would break a citation deep-link into a document that merely has
    // no register row yet.
    const documents = store.documents();
    const index = documents.findIndex((d) => d.docId === "infection-control");
    documents.splice(index, 1);
    const res = await read("infection-control");
    expect(res.status).toBe(200);
    expect((await res.json()).record).toBeNull();
  });

  it("reflects a live mutation on the record half", async () => {
    store.addDocumentNote("breach-response", "chased the owner", "Sam Okafor");
    const body = await (await read("breach-response")).json();
    expect(body.record.notes[0].text).toContain("chased the owner");
  });
});
