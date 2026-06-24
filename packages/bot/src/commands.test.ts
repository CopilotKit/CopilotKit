import { describe, it, expect } from "vitest";
import {
  normalizeCommandName,
  toCommandSpec,
  defineBotCommand,
} from "./commands.js";

describe("normalizeCommandName", () => {
  it("strips a leading slash, lowercases, and collapses hyphens to underscores", () => {
    expect(normalizeCommandName("/File-Issue")).toBe("file_issue");
    expect(normalizeCommandName("file-issue")).toBe("file_issue");
    expect(normalizeCommandName("file_issue")).toBe("file_issue");
    expect(normalizeCommandName("agent")).toBe("agent");
  });

  it("routes /file-issue and /file_issue to the same key (so Telegram's converted name still matches)", () => {
    expect(normalizeCommandName("file-issue")).toBe(
      normalizeCommandName("file_issue"),
    );
  });
});

describe("toCommandSpec", () => {
  it("preserves hyphens in the display name (Slack/Discord allow them)", () => {
    const cmd = defineBotCommand({
      name: "file-issue",
      description: "File an issue",
      handler: async () => {},
    });
    expect(toCommandSpec(cmd).name).toBe("file-issue");
  });
});
