import { describe, it, expect } from "vitest";
import { Message } from "@ag-ui/client";

describe("Import Test", () => {
  it("should import Message type", () => {
    const msg: Message = {
      id: "test",
      role: "user",
      content: "test",
    };
    expect(msg.id).toBe("test");
  });
});