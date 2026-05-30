import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies the vue MessageView cursor renders the stable
 * `copilot-loading-cursor` testid so e2e tests can deterministically detect
 * the "still loading" state. Aligns with the v2 react-core convention.
 */

const viewPath = resolve(__dirname, "../CopilotChatMessageView.vue");
const viewSrc = readFileSync(viewPath, "utf-8");

describe("vue stable testids", () => {
  it("CopilotChatMessageView cursor renders the copilot-loading-cursor testid", () => {
    expect(viewSrc).toMatch(/data-testid="copilot-loading-cursor"/);
  });
});
