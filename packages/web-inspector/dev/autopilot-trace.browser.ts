import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Frontend Tools shows a bounded filtered Autopilot trace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/?scenario=pro-enabled-existing&reset=1&autopilot-trace=1");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Frontend Tools" }).click();
  const inspector = page.locator("cpk-web-inspector");
  const trace = inspector.getByRole("region", { name: "Autopilot activity" });
  await expect(trace).toContainText("readVisiblePage");
  await expect(trace).toContainText("19 reads left");
  await expect(trace).toContainText("Autopilot scope allowed");
  await expect(trace).toContainText("Record fixture-order · version 2");
  await trace.getByText("Filtered result").click();
  await expect(trace).toContainText("New order");
  await page.screenshot({
    path: join(
      process.env.AUTOPILOT_EVIDENCE_DIR ?? tmpdir(),
      "inspector-autopilot-trace.png",
    ),
    fullPage: true,
  });
});
