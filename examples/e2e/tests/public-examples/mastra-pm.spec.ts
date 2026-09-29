import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("mastra-pm", () => {
  test.skip(EXAMPLE !== "mastra-pm", `EXAMPLE=${EXAMPLE}`);

  test("loads the project, team, and task board with a v2 runtime", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team Members", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "In Progress", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Build the product", { exact: true }).first(),
    ).toBeVisible();

    const board = await page.getByRole("main").boundingBox();
    const sidebar = await page
      .getByRole("complementary", { name: "Copilot chat sidebar" })
      .boundingBox();
    expect(board).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(board!.x + board!.width).toBeLessThanOrEqual(sidebar!.x + 1);

    const info = await request.get("/api/copilotkit/info");
    expect(info.ok()).toBe(true);
    expect(await info.json()).toMatchObject({
      agents: { default: expect.any(Object) },
    });
  });

  test("agent state updates the board through the v2 chat transport", async ({
    page,
  }) => {
    await page.route("**/api/copilotkit/agent/default/run", async (route) => {
      const input = route.request().postDataJSON();
      const events = [
        { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
        {
          type: "STATE_SNAPSHOT",
          snapshot: {
            ...input.state,
            projectName: "Release planning",
            tasks: [
              {
                id: 2,
                name: "Ship the v2 examples",
                description: "Verify all dashboard starters",
                status: "done",
                assignedTo: 1,
              },
            ],
          },
        },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "pm-reply",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "pm-reply",
          delta: "Updated the project board.",
        },
        { type: "TEXT_MESSAGE_END", messageId: "pm-reply" },
        { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
      ];
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Project", exact: true }),
    ).toBeVisible();
    const input = page.locator("textarea");
    await expect(input).toBeEnabled();
    await input.fill("Mark the v2 examples ready to ship.");
    const sendButton = page
      .getByRole("complementary", { name: "Copilot chat sidebar" })
      .locator("button")
      .last();
    await expect(sendButton).toBeEnabled();
    await sendButton.click();
    await expect(
      page.getByRole("heading", { name: "Release planning", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Ship the v2 examples", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Updated the project board.", { exact: true }),
    ).toBeVisible();
  });
});
