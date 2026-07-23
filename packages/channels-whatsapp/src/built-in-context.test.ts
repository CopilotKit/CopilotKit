import { describe, it, expect } from "vitest";
import { defaultWhatsAppTools } from "./built-in-tools.js";
import { defaultWhatsAppContext } from "./built-in-context.js";

describe("defaults", () => {
  it("ships no built-in tools in v1 (WhatsApp has no user directory)", () => {
    expect(defaultWhatsAppTools).toEqual([]);
  });

  it("ships formatting + no-streaming guidance context", () => {
    expect(defaultWhatsAppContext.length).toBeGreaterThan(0);
    const joined = defaultWhatsAppContext
      .map((c) => c.value)
      .join("\n")
      .toLowerCase();
    expect(joined).toContain("whatsapp");
    expect(joined).toMatch(/bold|formatting/);
  });
});
