import { test, expect } from "@playwright/test";

test.describe("Agent Config Object", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("page loads with config card and default dropdown values", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Agent Config" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-tone-select"]'),
    ).toHaveValue("professional");
    await expect(
      page.locator('[data-testid="agent-config-expertise-select"]'),
    ).toHaveValue("intermediate");
    await expect(
      page.locator('[data-testid="agent-config-length-select"]'),
    ).toHaveValue("concise");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("changing a dropdown updates its DOM value immediately", async ({
    page,
  }) => {
    const toneSelect = page.locator('[data-testid="agent-config-tone-select"]');
    await toneSelect.selectOption("enthusiastic");
    await expect(toneSelect).toHaveValue("enthusiastic");

    const expertiseSelect = page.locator(
      '[data-testid="agent-config-expertise-select"]',
    );
    await expertiseSelect.selectOption("expert");
    await expect(expertiseSelect).toHaveValue("expert");

    const lengthSelect = page.locator(
      '[data-testid="agent-config-length-select"]',
    );
    await lengthSelect.selectOption("detailed");
    await expect(lengthSelect).toHaveValue("detailed");
  });

  test("send produces an assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("properties object propagates to runtime requests", async ({ page }) => {
    const requestBodies: string[] = [];
    await page.route("**/api/copilotkit-agent-config**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const body = req.postData() ?? "";
        requestBodies.push(body);
      }
      await route.continue();
    });

    // Change all three dropdowns from defaults
    await page
      .locator('[data-testid="agent-config-tone-select"]')
      .selectOption("enthusiastic");
    await page
      .locator('[data-testid="agent-config-expertise-select"]')
      .selectOption("expert");
    await page
      .locator('[data-testid="agent-config-length-select"]')
      .selectOption("detailed");

    // Send
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    // Wait for at least one POST to land
    await expect
      .poll(() => requestBodies.length, { timeout: 15000 })
      .toBeGreaterThan(0);

    const payload = requestBodies.join("\n");
    expect(payload).toContain("enthusiastic");
    expect(payload).toContain("expert");
    expect(payload).toContain("detailed");
  });

  test("changing config between sends produces distinct request payloads", async ({
    page,
  }) => {
    // Only capture agent/run POSTs — agent/stop requests arrive
    // asynchronously and would pollute the "afterChange" slice.
    const requestBodies: string[] = [];
    await page.route("**/api/copilotkit-agent-config**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        const body = req.postData() ?? "";
        try {
          const parsed = JSON.parse(body);
          if (parsed.method === "agent/stop") {
            await route.continue();
            return;
          }
        } catch {
          // non-JSON body — keep it
        }
        requestBodies.push(body);
      }
      await route.continue();
    });

    const input = page.getByPlaceholder("Type a message");

    // Send 1 with defaults
    await input.fill("First");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({
      timeout: 30000,
    });

    // Wait for the chat to finish processing (data-copilot-running="false")
    // before attempting the second send — some backends finalize the SSE
    // stream slightly after the assistant message is rendered.
    await expect(page.locator('[data-copilot-running="false"]')).toBeVisible({
      timeout: 15000,
    });

    const firstCount = requestBodies.length;

    // Change config
    await page
      .locator('[data-testid="agent-config-tone-select"]')
      .selectOption("casual");
    await page
      .locator('[data-testid="agent-config-length-select"]')
      .selectOption("detailed");

    // Send 2
    await input.fill("Second");
    await input.press("Enter");
    await expect
      .poll(() => requestBodies.length, { timeout: 15000 })
      .toBeGreaterThan(firstCount);

    const beforeChange = requestBodies.slice(0, firstCount).join("\n");
    const afterChange = requestBodies.slice(firstCount).join("\n");

    expect(beforeChange).toContain("professional");
    expect(beforeChange).toContain("concise");
    expect(afterChange).toContain("casual");
    expect(afterChange).toContain("detailed");
  });
});
