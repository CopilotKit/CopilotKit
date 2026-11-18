import { describe, it, expect } from "vitest";
import {
  BULLETIN_THEMES,
  FRESH_CITATIONS,
  freshCitationFor,
} from "./bulletin-citations";
import { seedRegister } from "./register-seed";
import { KEEL_SPACES } from "@/skins/keel/knowledge/corpus";

const refsOnFile = () => seedRegister().map((record) => record.ref);

describe("the uncarried citation is genuinely uncarried", () => {
  it("names a ref the seeded register does not hold, for every space", () => {
    const onFile = refsOnFile();
    for (const space of KEEL_SPACES) {
      const fresh = freshCitationFor(space.id, onFile);
      // The row is the beat's proof of reading. If the seed ever came to carry
      // it, `freshCitationFor` returns undefined and this fails LOUDLY rather
      // than the demo quietly shipping a citation the agent could have read off
      // the ledger.
      expect(fresh, `no uncarried citation for ${space.id}`).toBeDefined();
      expect(onFile).not.toContain(fresh?.ref);
    }
  });

  it("DROPS the row rather than misattributing it once the register carries it", () => {
    const fresh = FRESH_CITATIONS.get("privacy");
    expect(fresh).toBeDefined();
    expect(
      freshCitationFor("privacy", [...refsOnFile(), fresh!.ref]),
    ).toBeUndefined();
  });

  it("matches on the canonical ref, so a respelled register still counts", () => {
    const fresh = FRESH_CITATIONS.get("vendor");
    expect(fresh).toBeDefined();
    const respelled = fresh!.ref.replace("-", " ").toLowerCase();
    expect(freshCitationFor("vendor", [respelled])).toBeUndefined();
  });

  it("carries a required action nothing in the register could supply", () => {
    for (const [, citation] of FRESH_CITATIONS) {
      expect(citation.requiredAction.trim().length).toBeGreaterThan(20);
    }
  });

  it("is keyed by space and never resolves a prototype key", () => {
    // A plain-object lookup would make `?space=constructor` truthy and put a
    // garbage row on the bulletin.
    expect(
      freshCitationFor("constructor" as never, refsOnFile()),
    ).toBeUndefined();
  });
});

describe("every corpus space has a bulletin to issue", () => {
  it("covers each space the knowledge pages advertise", () => {
    for (const space of KEEL_SPACES) {
      expect(BULLETIN_THEMES.get(space.id), space.id).toBeDefined();
    }
    expect(BULLETIN_THEMES.size).toBe(KEEL_SPACES.length);
  });

  it("states requirements the register cannot derive", () => {
    for (const [, theme] of BULLETIN_THEMES) {
      expect(theme.requirements.length).toBeGreaterThan(0);
      expect(theme.summary.length).toBeGreaterThan(0);
      expect(theme.source.trim()).not.toBe("");
    }
  });
});
