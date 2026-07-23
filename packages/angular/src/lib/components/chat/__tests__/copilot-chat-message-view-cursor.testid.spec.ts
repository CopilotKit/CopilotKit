import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies the angular cursor component renders the stable
 * `copilot-loading-cursor` testid so e2e tests can deterministically detect
 * the "still loading" state. Mirrors the convention already in place on the
 * v2 react-core Cursor.
 */

const cursorPath = resolve(__dirname, "../copilot-chat-message-view-cursor.ts");
const cursorSrc = readFileSync(cursorPath, "utf-8");

describe("angular stable testids", () => {
  it("CopilotChatMessageViewCursor renders the copilot-loading-cursor testid", () => {
    expect(cursorSrc).toMatch(/data-testid="copilot-loading-cursor"/);
  });
});
