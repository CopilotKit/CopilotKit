import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke coverage: the app shell loads, is branded, and the board renders the
 * seeded kanban. Runs against the deterministic mock stack.
 */

// The CopilotKit runtime injects a fixed-position <cpk-web-inspector> overlay
// (top-right) that can intercept pointer events on the mode toggle. Neutralize
// it for interaction tests — we aren't exercising the inspector here.
async function openApp(page: Page) {
  await page.goto("/");
  await page.addStyleTag({
    content: "cpk-web-inspector{pointer-events:none !important}",
  });
}

test.describe("PM Copilot — smoke", () => {
  test("loads with CopilotKit / PM Copilot branding and chat shell", async ({
    page,
  }) => {
    await openApp(page);

    await expect(page).toHaveTitle(/PM Copilot/i);
    await expect(page.getByText("PM Copilot").first()).toBeVisible();
    await expect(page.getByText("CopilotKit").first()).toBeVisible();

    await expect(page.getByText(/How can I help you today/i)).toBeVisible();
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();

    await expect(page.getByText("LangGraph").first()).toBeVisible();

    await expect(page.getByText("Plan next sprint")).toBeVisible();
    await expect(page.getByText("Analyze backlog")).toBeVisible();
  });

  // BLOCKED (Phase 4 / Ben's major #5 — threadId flow): in the local mock
  // stack a run never completes — the BFF returns THREAD_NOT_FOUND from the
  // Intelligence platform and no request reaches the agent, so the board never
  // seeds. Re-enable (remove .fixme) once the threadId/run flow is fixed.
  test.fixme("board renders the seeded kanban after the agent seeds state", async ({
    page,
  }) => {
    await openApp(page);

    // The LangGraph agent's SeedIssuesMiddleware seeds the board on its first
    // run, so kick off a turn. (Board is empty until an agent run or a chip.)
    const input = page.getByPlaceholder("Type a message...");
    await input.fill("Open the board");
    await input.press("Enter");

    // The EventInspector's fixed trigger overlaps the top-right mode toggle, so
    // a coordinate click routes to the wrong element. Dispatch directly.
    await page
      .getByRole("button", { name: "Board", exact: true })
      .dispatchEvent("click");

    // The seeded kanban paints in once state syncs from the agent.
    await expect(
      page.getByText(/Payment integration flaky on Safari/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Postgres connection pool exhaustion/i),
    ).toBeVisible();

    for (const col of ["Backlog", "Todo", "In Progress", "In Review", "Done"]) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible();
    }
  });

  test("removed Next/Vercel starter SVGs are not served as assets", async ({
    request,
  }) => {
    // In Vite dev, a missing public file falls through to the SPA HTML shell,
    // so assert the response is NOT svg content (the file is gone).
    for (const svg of ["next", "vercel", "window", "globe", "file"]) {
      const res = await request.get(`/${svg}.svg`);
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType, `${svg}.svg should not be served as SVG`).not.toContain(
        "svg",
      );
    }
  });
});
