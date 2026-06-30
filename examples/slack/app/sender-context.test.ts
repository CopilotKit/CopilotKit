import { describe, it, expect } from "vitest";
import { senderContext } from "./sender-context.js";

describe("senderContext", () => {
  it("returns [] when there is no user", () => {
    expect(senderContext(undefined, "slack")).toEqual([]);
  });

  it("labels a slack user with email", () => {
    const out = senderContext(
      { id: "U1", name: "Ada", email: "ada@x.io" },
      "slack",
    );
    expect(out).toEqual([
      {
        description: "Requesting slack user",
        value: "Ada <ada@x.io> (slack id U1)",
      },
    ]);
  });

  it("labels a whatsapp user (no email) with the platform", () => {
    const out = senderContext({ id: "15551230000", name: "Bob" }, "whatsapp");
    expect(out).toEqual([
      {
        description: "Requesting whatsapp user",
        value: "Bob (whatsapp id 15551230000)",
      },
    ]);
  });

  it("falls back to the id when the user has no name (e.g. a WhatsApp sender)", () => {
    const out = senderContext({ id: "15551230000" }, "whatsapp");
    expect(out).toEqual([
      {
        description: "Requesting whatsapp user",
        value: "15551230000 (whatsapp id 15551230000)",
      },
    ]);
  });
});
