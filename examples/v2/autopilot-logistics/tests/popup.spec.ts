import { expect, test } from "@playwright/test";
import { evidencePath } from "./evidence";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

test("CopilotPopup keeps the assistant controls and chat available", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Avery Morgan/ }).click();

  const popup = page.getByTestId("copilot-popup");
  await expect(popup).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    popup.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("logistics");
  await expect(
    popup.getByRole("combobox", { name: "Autopilot scope" }),
  ).toHaveValue("logistics");
  await expect(popup.getByRole("textbox")).toBeVisible();

  const screenshot = evidencePath("popup", "copilot-popup.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(
    page.getByRole("heading", { name: "Create order" }),
  ).toBeVisible();
  await page.getByTestId("copilot-chat-toggle").click();
  await expect(popup).toBeVisible();
  await popup
    .getByRole("combobox", { name: "Assistant agent" })
    .selectOption("operations");
  await expect(
    popup.getByRole("combobox", { name: "Assistant agent" }),
  ).toHaveValue("operations");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
});
