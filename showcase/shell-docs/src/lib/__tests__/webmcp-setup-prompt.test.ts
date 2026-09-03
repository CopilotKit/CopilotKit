import { expect, test } from "vitest";
import { WEBMCP_SETUP_PROMPT } from "../webmcp-setup-prompt";

test("keeps the standalone WebMCP setup prompt small and outcome-focused", () => {
  expect(WEBMCP_SETUP_PROMPT).toBe(
    "Set up WebMCP in this project using https://docs.copilotkit.ai/webmcp. Follow the guide and verify that a compatible browser can discover and call the tool.",
  );
  expect(WEBMCP_SETUP_PROMPT).not.toContain("onboard");
});
