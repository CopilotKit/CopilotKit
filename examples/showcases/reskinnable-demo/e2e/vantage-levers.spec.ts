import { expect, test } from "@playwright/test";

/**
 * Beat 3c's mechanism, minus the agent: URL params -> recomputed figures ->
 * VISIBLY highlighted controls. If the highlight regresses, the beat still
 * looks like it works to a developer (URL is right) and proves nothing to an
 * audience watching the screen, so every test here asserts `data-active` on
 * the levers, not just the URL or the value.
 */
test.describe("vantage explore levers", () => {
  test("applies lens params from the URL and highlights only the set levers", async ({
    page,
  }) => {
    await page.goto("/vantage/explore?region=emea&compare=vs-plan");

    await expect(page.getByTestId("lever-region")).toHaveValue("emea");
    await expect(page.getByTestId("lever-compare")).toHaveValue("vs-plan");

    // Set axes are highlighted; untouched ones are not.
    await expect(page.getByTestId("lever-region")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("lever-compare")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("lever-segment")).toHaveAttribute(
      "data-active",
      "false",
    );
    await expect(page.getByTestId("lever-grain")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  test("moving a lever recomputes the figures, not just the URL", async ({
    page,
  }) => {
    await page.goto("/vantage/explore?region=emea");
    const emeaTotal = await page.locator(".nw-figure").first().innerText();

    await page.getByTestId("lever-region").selectOption("namer");
    await expect(page).toHaveURL(/region=namer/);
    await expect(page.locator(".nw-figure").first()).not.toHaveText(emeaTotal);
  });

  test("an unknown lens value falls back to the default instead of erroring", async ({
    page,
  }) => {
    await page.goto("/vantage/explore?period=next-tuesday");
    await expect(page.getByTestId("lever-period")).toHaveValue("q3-2026");
  });

  test("moving a lever preserves an explicitly-set breakdown dimension", async ({
    page,
  }) => {
    // Land with the breakdown explicitly split by segment (off this page's
    // "region" default). Segment rows are labelled "Enterprise" /
    // "Mid-market" / "SMB"; region rows are labelled "NAMER" / "EMEA" /
    // "APAC" — the labels are how we prove which dimension actually rendered,
    // not just what the URL claims.
    await page.goto("/vantage/explore?dimension=segment");
    const breakdown = page
      .locator("section")
      .filter({ hasText: "Where it came from" });
    await expect(breakdown.getByText("Enterprise")).toBeVisible();

    // Move an unrelated lever (region). This must not touch `dimension`.
    await page.getByTestId("lever-region").selectOption("namer");
    await expect(page).toHaveURL(/region=namer/);

    // The dimension param must still be `segment`, and the breakdown must
    // still be rendering segment rows, not region rows.
    await expect(page).toHaveURL(/dimension=segment/);
    await expect(breakdown.getByText("Enterprise")).toBeVisible();
  });
});
