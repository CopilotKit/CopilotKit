import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ARTIFACTS_DIR, hasProviderKey, launchElectronApp } from "./helpers";

test.describe("browser bridge", () => {
  let app: ElectronApplication | undefined;

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  test("shows bridge pairing info, disconnected until an extension connects", async () => {
    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(
      page.getByRole("heading", { name: "CopilotKit Electron Starter" }),
    ).toBeVisible();

    await expect(page.getByTestId("bridge-panel")).toBeVisible({
      timeout: 15_000,
    });

    expect(
      await page.getByTestId("bridge-status").getAttribute("aria-label"),
    ).toEqual("disconnected");

    const token = (await page.getByTestId("bridge-token").innerText()).trim();
    expect(token.length).toBeGreaterThan(10);

    const port = Number(
      (await page.getByTestId("bridge-port").innerText()).trim(),
    );
    expect(port).toBeGreaterThan(0);

    await page.screenshot({ path: join(ARTIFACTS_DIR, "bridge-panel.png") });
  });

  test("reads the active tab through a paired extension (needs a provider key)", async () => {
    test.skip(
      !hasProviderKey,
      "set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY to run the bridge read demo",
    );

    const { app: launched, page } = await launchElectronApp();
    app = launched;

    await expect(page.getByTestId("bridge-panel")).toBeVisible({
      timeout: 15_000,
    });

    const port = Number(
      (await page.getByTestId("bridge-port").innerText()).trim(),
    );
    const token = (await page.getByTestId("bridge-token").innerText()).trim();

    const fakeExt = new WebSocket(
      "ws://127.0.0.1:" + port + "/?token=" + encodeURIComponent(token),
    );

    try {
      await new Promise<void>((res, rej) => {
        fakeExt.on("open", res);
        fakeExt.on("error", rej);
      });

      fakeExt.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "request" && msg.method === "readActiveTab") {
          fakeExt.send(
            JSON.stringify({
              type: "result",
              id: msg.id,
              data: {
                url: "https://example.com",
                title: "Example",
                selection: "",
                text: "bridge-sentinel-xyz",
              },
            }),
          );
        }
      });

      await expect(page.getByTestId("bridge-status")).toHaveAttribute(
        "aria-label",
        "connected",
        { timeout: 10_000 },
      );

      await page
        .getByRole("textbox")
        .last()
        .fill(
          "Use your browser_read_active_tab tool to read my active tab, then tell me the exact text content it returned.",
        );
      await page.getByRole("textbox").last().press("Enter");

      await expect(page.getByText("bridge-sentinel-xyz").last()).toBeVisible({
        timeout: 45_000,
      });

      await page.screenshot({ path: join(ARTIFACTS_DIR, "bridge-read.png") });
    } finally {
      fakeExt.close();
    }
  });
});
