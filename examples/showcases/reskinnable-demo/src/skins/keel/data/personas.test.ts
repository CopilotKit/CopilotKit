import { describe, it, expect } from "vitest";
import { KEEL_PERSONAS, DEFAULT_PERSONA_ID, getPersona } from "./personas";

describe("keel personas", () => {
  it("ships exactly four personas with unique ids", () => {
    expect(KEEL_PERSONAS).toHaveLength(4);
    const ids = KEEL_PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("gives every persona a distinct role, since role is the approval key", () => {
    const roles = KEEL_PERSONAS.map((p) => p.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("has a default persona that exists", () => {
    expect(KEEL_PERSONAS.some((p) => p.id === DEFAULT_PERSONA_ID)).toBe(true);
  });

  it("resolves a known persona by id", () => {
    expect(getPersona("sam-okafor").role).toBe("Privacy Officer");
  });

  it("falls back to the default persona for an unknown id", () => {
    expect(getPersona("nobody").id).toBe(DEFAULT_PERSONA_ID);
  });
});
