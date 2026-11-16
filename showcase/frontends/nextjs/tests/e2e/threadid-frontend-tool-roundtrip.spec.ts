import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/threadid-frontend-tool-roundtrip/page.tsx
//
// The regression test for ENT-658 itself lives in react-core. This smoke
// test keeps the demo page and its generated-thread toggle covered, without
// depending on fixture-driven tool execution.

describeDemo(
  "threadid-frontend-tool-roundtrip",
  "Thread ID frontend-tool round trip",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("threadid-frontend-tool-roundtrip"));
    });

    test("page loads with generated-thread mode selected", async ({ page }) => {
      await expect(page.getByPlaceholder("Type a message")).toBeVisible();
      await expect(page.getByLabel("Explicit threadId")).not.toBeChecked();
      await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
        /SDK-generated thread/i,
      );

      await page.getByLabel("Explicit threadId").check();
      await expect(page.getByTestId("ent-658-thread-mode")).toHaveText(
        /explicit thread/i,
      );
    });
  },
);
