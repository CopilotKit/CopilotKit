import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { join } from "node:path";
import { ARTIFACTS_DIR, hasProviderKey, launchElectronApp } from "./helpers";

test.describe("electron app shell", () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test("boots the built app and renders the shell", async () => {
    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(
      page.getByRole("heading", { name: "CopilotKit Electron Starter" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "An AI-powered desktop app built with Electron and CopilotKit. Ask the assistant anything using the sidebar on the right.",
        { exact: false },
      ),
    ).toBeVisible();

    await page.screenshot({ path: join(ARTIFACTS_DIR, "shell.png") });
  });

  test("round-trips a chat message (needs a provider key)", async () => {
    test.skip(
      !hasProviderKey,
      "set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY to run the chat round-trip",
    );

    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(
      page.getByRole("heading", { name: "CopilotKit Electron Starter" }),
    ).toBeVisible();

    const input = page.getByRole("textbox").last();
    const baselineLength = (await page.locator("body").innerText()).length;
    await input.click();
    await input.fill("Hello");
    await input.press("Enter");

    // The assistant's streamed reply grows the page text well beyond the
    // echoed prompt; assert on that growth rather than on specific reply
    // wording (which is non-deterministic).
    await expect
      .poll(async () => (await page.locator("body").innerText()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(baselineLength + 20);

    await page.screenshot({ path: join(ARTIFACTS_DIR, "chat.png") });
  });
});
