import { expect, test } from "@playwright/test";

for (const transport of ["rest", "single"] as const) {
  test(`restores copied Learning setup over ${transport}`, async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:5177",
    });
    await page.goto(
      `/learning-states.html?state=landing&preserveSetup=true&transport=${transport}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });

    await page
      .getByRole("button", { name: "Copy setup prompt for Threads" })
      .click();

    const setup = page.getByRole("region", { name: "Set up Learning" });
    await expect(setup.getByText("1 of 3 steps")).toBeVisible();
    await expect(
      setup.getByRole("heading", { name: "Waiting for the first Thread" }),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });
    await expect(setup.getByText("1 of 3 steps")).toBeVisible();
    await expect(
      setup.getByRole("heading", { name: "Waiting for the first Thread" }),
    ).toBeVisible();
  });
}
