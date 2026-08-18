import { describe, it, expect } from "vitest";
import { senderContext } from "./sender-context.js";

describe("senderContext", () => {
  it("returns [] when there is no user", () => {
    expect(senderContext(null, "slack")).toEqual([]);
  });

  it("labels the canonical application user", () => {
    const out = senderContext({ id: "user-1", name: "Ada" }, "slack");
    expect(out).toEqual([
      {
        description: "Requesting slack user",
        value: "Ada (application user user-1)",
      },
    ]);
  });

  it("labels a whatsapp user (no email) with the platform", () => {
    const out = senderContext({ id: "15551230000", name: "Bob" }, "whatsapp");
    expect(out).toEqual([
      {
        description: "Requesting whatsapp user",
        value: "Bob (application user 15551230000)",
      },
    ]);
  });
});
