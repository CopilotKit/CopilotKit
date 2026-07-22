import { describe, expect, it } from "vitest";

import { messageText, toolArguments } from "./headless-message-utils";

describe("headless chat message boundaries", () => {
  it("renders only string message content", () => {
    expect(messageText({ id: "1", role: "assistant", content: "Hello" })).toBe(
      "Hello",
    );
    expect(
      messageText({ id: "2", role: "assistant", content: { html: "unsafe" } }),
    ).toBe("");
  });

  it("accepts object tool arguments and contains malformed payloads", () => {
    expect(toolArguments('{"location":"Tokyo"}')).toEqual({
      location: "Tokyo",
    });
    expect(toolArguments("not-json")).toEqual({});
    expect(toolArguments("[1,2,3]")).toEqual({});
  });
});
