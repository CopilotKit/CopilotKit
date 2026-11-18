import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";
import * as store from "@/skins/keel/data/store";
import type { KeelLedger } from "@/skins/keel/data/types";

beforeEach(() => store.reset());

const read = async (): Promise<KeelLedger> => (await GET()).json();

describe("GET /ledger", () => {
  it("returns the whole world in one snapshot", () => {
    return read().then((ledger) => {
      expect(ledger.documents).toHaveLength(9);
      expect(ledger.runs).toHaveLength(4);
      expect(ledger.playbooks).toHaveLength(4);
      expect(ledger.personas.length).toBeGreaterThan(0);
      expect(ledger.variances).toEqual([]);
      expect(ledger.impactBriefs).toEqual([]);
    });
  });

  it("stamps WHEN, so a consumer holding it can say so", () => {
    return read().then((ledger) => {
      expect(Number.isFinite(Date.parse(ledger.asOf))).toBe(true);
    });
  });

  it("reflects a mutation immediately — no cached snapshot", () => {
    store.raiseReviewFlag("breach-response", "review-overdue", "Sam Okafor");
    return read().then((ledger) => {
      expect(
        ledger.documents.find((d) => d.docId === "breach-response")?.reviewFlag,
      ).toBeDefined();
    });
  });

  it("carries the register fields the readables and sandbox functions need", () => {
    return read().then((ledger) => {
      const record = ledger.documents.find((d) => d.ref === "POL-114");
      expect(record).toMatchObject({
        docId: "phi-access-policy",
        space: "privacy",
        owner: "Privacy Office",
      });
      expect(record?.pendingRevision?.label).toBe("Rev D");
      expect(record?.attestation.assigned).toBeGreaterThan(0);
    });
  });
});
