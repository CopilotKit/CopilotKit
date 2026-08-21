import { expect, test } from "@playwright/test";

const forbiddenAwsPatterns = [
  /amazonaws\.com/i,
  /aws\.amazon\.com/i,
  /169\.254\.169\.254/i,
  /fd00:ec2::254/i,
];

test("primary Cloudplot prompt stays inside the simulation boundary", async ({
  page,
}) => {
  const blocked: string[] = [];

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (forbiddenAwsPatterns.some((pattern) => pattern.test(url))) {
      blocked.push(url);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto("/");
  await expect(page.getByText("CloudPlot").first()).toBeVisible();
  await expect(page.getByText("Web App")).toBeVisible();
  expect(blocked).toEqual([]);
});
