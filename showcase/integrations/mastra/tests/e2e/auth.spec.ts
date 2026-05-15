import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("page loads with authenticated banner by default", async ({ page }) => {
    await page.goto("/demos/auth");
    await expect(page.getByTestId("auth-banner")).toBeVisible();
    await expect(page.getByTestId("auth-banner")).toHaveAttribute(
      "data-authenticated",
      "true",
    );
    await expect(page.getByTestId("auth-sign-out-button")).toBeVisible();
  });

  test("sign out flips banner to unauthenticated and reveals Sign in button", async ({
    page,
  }) => {
    await page.goto("/demos/auth");
    await page.getByTestId("auth-sign-out-button").click();
    await expect(page.getByTestId("auth-banner")).toHaveAttribute(
      "data-authenticated",
      "false",
    );
    await expect(page.getByTestId("auth-authenticate-button")).toBeVisible();
  });
});
