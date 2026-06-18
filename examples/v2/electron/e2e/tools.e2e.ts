import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { join } from "node:path";
import { ARTIFACTS_DIR, hasProviderKey, launchElectronApp } from "./helpers";

test.describe("local tools — HITL approval", () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test("approves an fs_write and shows the outcome (needs a provider key)", async () => {
    test.skip(
      !hasProviderKey,
      "set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY to run the HITL demo",
    );

    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(
      page.getByRole("heading", { name: "CopilotKit Electron Starter" }),
    ).toBeVisible();

    const input = page.getByRole("textbox").last();
    await input.click();
    await input.fill(
      "Use your fs_write tool to create a file named demo.txt containing exactly: hello from copilotkit",
    );
    await input.press("Enter");

    await expect(page.getByTestId("approval-approve")).toBeVisible({
      timeout: 30_000,
    });

    await page.screenshot({ path: join(ARTIFACTS_DIR, "hitl-prompt.png") });

    await page.getByTestId("approval-approve").click();

    await expect(page.getByTestId("approval-outcome").last()).toBeVisible({
      timeout: 30_000,
    });

    await page.screenshot({ path: join(ARTIFACTS_DIR, "hitl-result.png") });
  });
});
