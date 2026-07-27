import { describe, it, expect } from "vitest";
import { Section } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { irToText } from "./ir-to-text.js";

const text = (value: string): ChannelNode =>
  ({ type: "text", props: { value } }) as unknown as ChannelNode;

describe("irToText", () => {
  it("returns the value of a single text node (the streamed-agent path)", () => {
    expect(irToText([text("hello world")])).toBe("hello world");
  });

  it("flattens nested children to text", () => {
    expect(irToText([Section({ children: "reply" }) as ChannelNode])).toBe(
      "reply",
    );
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
