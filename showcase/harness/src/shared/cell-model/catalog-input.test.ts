import { describe, it, expect } from "vitest";
import {
  catalogCellToInput,
  type CellStructuralInput,
} from "./catalog-input.js";

const base: CellStructuralInput = {
  integration: "langgraph-python",
  feature: "agentic-chat",
  manifestation: "integrated",
  status: "wired",
};

describe("catalogCellToInput — §5a mapping", () => {
  it("wired agent cell → agent axis, supported, wired, feature passed through", () => {
    expect(catalogCellToInput(base)).toEqual({
      slug: "langgraph-python",
      featureId: "agentic-chat",
      isSupported: true,
      isWired: true,
      probeAxis: "agent",
    });
  });

  it("null feature is passed through", () => {
    expect(catalogCellToInput({ ...base, feature: null }).featureId).toBeNull();
  });

  it("starter manifestation → starter axis", () => {
    const out = catalogCellToInput({
      ...base,
      manifestation: "starter",
      feature: null,
    });
    expect(out.probeAxis).toBe("starter");
    expect(out.slug).toBe("langgraph-python");
  });

  it("stub → supported + wired", () => {
    const out = catalogCellToInput({ ...base, status: "stub" });
    expect(out.isSupported).toBe(true);
    expect(out.isWired).toBe(true);
  });

  it("unshipped → supported but NOT wired", () => {
    const out = catalogCellToInput({ ...base, status: "unshipped" });
    expect(out.isSupported).toBe(true);
    expect(out.isWired).toBe(false);
  });

  it("unsupported → NOT supported, NOT wired", () => {
    const out = catalogCellToInput({ ...base, status: "unsupported" });
    expect(out.isSupported).toBe(false);
    expect(out.isWired).toBe(false);
  });
});
