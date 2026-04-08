const { test, expect } = require("@playwright/test");

test("integration picker resets on home and A2UI folder label stays expanded name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 1100 });

  await page.goto(
    "http://localhost:3001/integrations/langgraph/generative-ui/tool-rendering",
    { waitUntil: "networkidle" },
  );

  await expect(page.getByText("LangGraph", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Declerative Gen-UI (A2UI)", { exact: true }),
  ).toBeVisible();

  await page.goto("http://localhost:3001/", { waitUntil: "networkidle" });

  await expect(
    page.getByText("Select integration...", { exact: true }),
  ).toBeVisible();

  await page.goto(
    "http://localhost:3001/integrations/langgraph/generative-ui/tool-rendering",
    { waitUntil: "networkidle" },
  );

  await expect(
    page.getByText("Declerative Gen-UI (A2UI)", { exact: true }),
  ).toBeVisible();
});
