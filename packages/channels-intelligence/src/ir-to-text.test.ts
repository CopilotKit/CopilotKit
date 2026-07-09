import { describe, it, expect } from "vitest";
import { Section } from "@copilotkit/channels-ui";
import type { BotNode } from "@copilotkit/channels-ui";
import { irToText } from "./ir-to-text.js";

const text = (value: string): BotNode =>
  ({ type: "text", props: { value } }) as unknown as BotNode;

describe("irToText", () => {
  it("returns the value of a single text node (the streamed-agent path)", () => {
    expect(irToText([text("hello world")])).toBe("hello world");
  });

  it("flattens nested children to text", () => {
    expect(irToText([Section({ children: "reply" }) as BotNode])).toBe("reply");
  });

  it("joins multiple top-level nodes with newlines", () => {
    expect(irToText([text("line one"), text("line two")])).toBe(
      "line one\nline two",
    );
  });

  it("returns empty string for empty or empty-valued ir", () => {
    expect(irToText([])).toBe("");
    expect(irToText([text("")])).toBe("");
  });
});
