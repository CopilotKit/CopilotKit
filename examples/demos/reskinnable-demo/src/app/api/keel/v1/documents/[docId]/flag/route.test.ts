import { describe, it, expect, beforeEach } from "vitest";
import { POST as FLAG } from "./route";
import { POST as NOTICE } from "../notices/route";
import { POST as NOTE } from "../notes/route";
import * as store from "@/skins/keel/data/store";
import { getPersona } from "@/skins/keel/data/personas";
import {
  NOTE_MARKER,
  OWNER_NOTICE_TEMPLATES,
  REVIEW_FLAG_REASONS,
} from "@/skins/keel/data/handling";
import { VARIANCE_CODES } from "@/skins/keel/data/variance-codes";

beforeEach(() => store.reset());

const SAM = getPersona("sam-okafor");
const DOC = "breach-response";

const post = (
  handler: (
    req: Request,
    ctx: { params: Promise<{ docId: string }> },
  ) => Promise<Response>,
  docId: string,
  body: unknown,
) =>
  handler(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ docId }) },
  );

/**
 * BEAT 5 — the three writes the stored procedure fires, in order, all on ONE
 * record. Their vocabularies are CLOSED and GIVEN to the agent, which is the
 * exact opposite of beat 6's variance catalogue, so their refusals DO name the
 * valid set. That contrast is asserted rather than left to a comment: the two
 * sets sit one directory apart and are the easiest pair in this demo to confuse.
 */
describe("BEAT 5 step 1 — raise a review flag", () => {
  it("raises the flag and derives who raised it from the persona", async () => {
    const res = await post(FLAG, DOC, {
      reason: "review-overdue",
      personaId: SAM.id,
    });
    expect(res.status).toBe(201);
    expect(store.findDocument(DOC)?.reviewFlag).toMatchObject({
      reason: "review-overdue",
      raisedBy: SAM.name,
    });
  });

  it("ignores a raisedBy in the body — that would be forging who flagged it", async () => {
    await post(FLAG, DOC, {
      reason: "review-overdue",
      personaId: SAM.id,
      raisedBy: "Somebody Else",
    });
    expect(store.findDocument(DOC)?.reviewFlag?.raisedBy).toBe(SAM.name);
  });

  it("422s an unknown reason AND names the valid set, unlike a variance refusal", async () => {
    const res = await post(FLAG, DOC, { reason: "vibes", personaId: SAM.id });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REVIEW_REASON");
    for (const reason of REVIEW_FLAG_REASONS) {
      expect(body.message).toContain(reason);
    }
    // …and still leaks nothing about the WITHHELD catalogue.
    for (const code of VARIANCE_CODES) {
      expect(JSON.stringify(body)).not.toContain(code);
    }
  });

  it("400s an unknown persona and 404s an unknown document", async () => {
    expect((await post(FLAG, DOC, { reason: "review-overdue" })).status).toBe(
      400,
    );
    expect(
      (
        await post(FLAG, "nope", {
          reason: "review-overdue",
          personaId: SAM.id,
        })
      ).status,
    ).toBe(404);
  });
});

describe("BEAT 5 step 2 — notify the owning department", () => {
  it("copies the owner off the RECORD, not from the caller", async () => {
    const res = await post(NOTICE, DOC, {
      template: "review-due",
      personaId: SAM.id,
      owner: "Somebody Else",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).owner).toBe(store.findDocument(DOC)?.owner);
  });

  it("422s an unknown template and names the valid set", async () => {
    const res = await post(NOTICE, DOC, {
      template: "shouting",
      personaId: SAM.id,
    });
    expect(res.status).toBe(422);
    for (const template of OWNER_NOTICE_TEMPLATES) {
      expect((await res.clone().json()).message).toContain(template);
    }
  });

  it("keeps notices newest first", async () => {
    await post(NOTICE, DOC, { template: "review-due", personaId: SAM.id });
    await post(NOTICE, DOC, {
      template: "attestation-push",
      personaId: SAM.id,
    });
    expect(store.findDocument(DOC)?.ownerNotices?.[0].template).toBe(
      "attestation-push",
    );
  });
});

describe("BEAT 5 step 3 — post a note the room can see", () => {
  it("FORCES the marker even when the model phrased it politely", async () => {
    const res = await post(NOTE, DOC, {
      text: "This is past its review date.",
      personaId: SAM.id,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).text.startsWith(NOTE_MARKER)).toBe(true);
  });

  it("422s an empty note", async () => {
    expect(
      (await post(NOTE, DOC, { text: "   ", personaId: SAM.id })).status,
    ).toBe(422);
    expect((await post(NOTE, DOC, { personaId: SAM.id })).status).toBe(422);
  });

  it("400s an unknown persona and 404s an unknown document", async () => {
    expect((await post(NOTE, DOC, { text: "x" })).status).toBe(400);
    expect(
      (await post(NOTE, "nope", { text: "x", personaId: SAM.id })).status,
    ).toBe(404);
  });
});

describe("all three writes land on ONE record", () => {
  it("leaves the flag, the notice and the note on the same document", async () => {
    await post(FLAG, DOC, { reason: "review-overdue", personaId: SAM.id });
    await post(NOTICE, DOC, { template: "review-due", personaId: SAM.id });
    await post(NOTE, DOC, { text: "Chased the owner.", personaId: SAM.id });
    const record = store.findDocument(DOC);
    expect(record?.reviewFlag).toBeDefined();
    expect(record?.ownerNotices).toHaveLength(1);
    expect(record?.notes).toHaveLength(1);
    // …and touched nothing else, so "it picked the right three" means something.
    expect(
      store.documents().filter((d) => d.docId !== DOC && d.reviewFlag),
    ).toHaveLength(0);
  });
});
