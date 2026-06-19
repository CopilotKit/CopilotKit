import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { join } from "node:path";
import { ARTIFACTS_DIR, hasProviderKey, launchElectronApp } from "./helpers";

test.describe("MCP manager", () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test("connects the bundled MCP server and shows it ready", async () => {
    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(
      page.getByRole("heading", { name: "CopilotKit Electron Starter" }),
    ).toBeVisible();

    await expect(page.getByTestId("mcp-server-everything")).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByTestId("mcp-status-everything")).toHaveAttribute(
      "aria-label",
      "ready",
      { timeout: 60_000 },
    );

    await page.screenshot({ path: join(ARTIFACTS_DIR, "mcp-panel.png") });
  });

  test("calls an MCP tool end-to-end (needs a provider key)", async () => {
    test.skip(
      !hasProviderKey,
      "set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY to run the MCP tool-call demo",
    );

    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(page.getByTestId("mcp-status-everything")).toHaveAttribute(
      "aria-label",
      "ready",
      { timeout: 60_000 },
    );

    const input = page.getByRole("textbox").last();
    await input.fill(
      "Use the MCP 'echo' tool to echo back exactly: copilotkit-mcp-ok. Then tell me what it returned.",
    );
    await input.press("Enter");

    await expect(page.getByText("copilotkit-mcp-ok").last()).toBeVisible({
      timeout: 45_000,
    });

    await page.screenshot({ path: join(ARTIFACTS_DIR, "mcp-tool-call.png") });
  });
});
