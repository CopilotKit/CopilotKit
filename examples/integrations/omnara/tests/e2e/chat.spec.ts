import { expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Model the licensed Intelligence thread-list contract while chat uses local fixtures.
// Uncaught exceptions in the page fail the test that caused them.
let pageErrors: Error[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.route("**/api/copilotkit/info", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), licenseStatus: "valid" },
    });
  });
  await page.route("**/api/copilotkit/threads?*", (route) =>
    route.fulfill({ json: { threads: [] } }),
  );
});

test.afterEach(() => {
  expect(pageErrors.map((error) => error.message)).toEqual([]);
});

test("chat streams a reply, continues, and starts a separate conversation", async ({
  page,
}) => {
  const threadIds: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/agent/default/run")) {
      const body = request.postDataJSON();
      threadIds.push(body.threadId);
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("copilot-threads-drawer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Web Inspector/ }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "CopilotKit" })).toHaveCount(0);
  await page.getByRole("textbox").fill("Hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Hello! This is a local mock response from the starter.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("Continue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("This is the second response in the same conversation.", {
      exact: true,
    }),
  ).toBeVisible();
  // A repeated reply gets its own bubble rather than merging into the last one.
  await page.getByRole("textbox").fill("And again");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("This is the second response in the same conversation.", {
      exact: true,
    }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "New Conversation", exact: true })
    .click();
  await expect(
    page.getByText("How can I help you today?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("Fresh start");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Hello! This is a local mock response from the starter.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(threadIds).toHaveLength(4);
  expect(new Set(threadIds.slice(0, 3)).size).toBe(1);
  expect(threadIds[3]).not.toBe(threadIds[0]);
});

test("web searches show as tool cards", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("Search the web for Omnara");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const card = page.locator('[data-testid="copilot-tool-render"]', {
    has: page.getByText("web_search", { exact: true }),
  });
  await expect(card).toBeVisible();
  await expect(
    page.getByText("Omnara is an open-source managed agent platform.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("an Omnara approval renders in the chat and resumes the agent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("Run the tests");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const approval = page.getByRole("group", {
    name: "Permission requested for run_command",
  });
  await expect(approval).toBeVisible();
  await expect(approval.getByText("npm test", { exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(
    page.getByText("Approved. The command ran.", { exact: true }),
  ).toBeVisible();
  await expect(approval).toHaveCount(0);
});

test("denying an Omnara approval resumes the agent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("Run the tests");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const approval = page.getByRole("group", {
    name: "Permission requested for run_command",
  });
  await approval.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(
    page.getByText("Denied. I won't run the command.", { exact: true }),
  ).toBeVisible();
});

test("an approval raised again after a failed answer can be retried", async ({
  page,
}) => {
  // When an answer doesn't reach Omnara, the adapter raises the still-open
  // interaction again. Replay the approval run, delivered all at once.
  let approvalRun: string | undefined;
  let raisedAgain = false;
  await page.route("**/agent/default/run", async (route) => {
    if (!route.request().postDataJSON().resume) {
      const response = await route.fetch();
      approvalRun = await response.text();
      return route.fulfill({ response, body: approvalRun });
    }
    if (raisedAgain) return route.fallback();
    raisedAgain = true;
    return route.fulfill({
      contentType: "text/event-stream",
      body: approvalRun,
    });
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("Run the tests");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const approval = page.getByRole("group", {
    name: "Permission requested for run_command",
  });
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => raisedAgain).toBe(true);
  const allow = approval.getByRole("button", { name: "Allow", exact: true });
  await expect(allow).toBeEnabled();
  await allow.click();
  await expect(
    page.getByText("Approved. The command ran.", { exact: true }),
  ).toBeVisible();
});

test("a failed resume doesn't block the next message", async ({ page }) => {
  // Fail the first resume, as a dropped connection or a server restart would.
  let failed = false;
  await page.route("**/agent/default/run", (route) => {
    if (failed || !route.request().postDataJSON().resume)
      return route.fallback();
    failed = true;
    return route.fulfill({ status: 503 });
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("Run the tests");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const approval = page.getByRole("group", {
    name: "Permission requested for run_command",
  });
  await approval.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(approval).toHaveCount(0);
  await page.getByRole("textbox").fill("Continue");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("This is the second response in the same conversation.", {
      exact: true,
    }),
  ).toBeVisible();
});

// Details only go with an option that takes them; Omnara rejects them otherwise.
for (const { name, picks, answer } of [
  {
    name: "an Other answer with details",
    picks: ["Other"],
    answer: { optionIndices: [2], text: "Pottery" },
  },
  {
    name: "no details once Other is unpicked",
    picks: ["Other", "Hiking"],
    answer: { optionIndices: [0] },
  },
]) {
  test(`an Omnara question takes ${name}`, async ({ page }) => {
    const resumes: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/agent/default/run")) {
        const resume = request.postDataJSON().resume;
        if (resume) resumes.push(resume);
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Help me decide" }).click();
    const card = page.getByRole("group", { name: "Question" });
    const submit = card.getByRole("button", { name: "Submit", exact: true });
    await expect(submit).toBeDisabled();
    for (const label of picks) {
      await card.getByRole("button", { name: label, exact: true }).click();
      if (label === "Other")
        await card
          .getByRole("textbox", { name: "Details (optional)" })
          .fill("Pottery");
    }
    await submit.click();
    await expect(
      page.getByText("Thanks. Let's plan a pottery weekend.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Help me decide" }),
    ).toBeVisible();
    expect(resumes).toEqual([
      [
        {
          interruptId: "int_question",
          status: "resolved",
          payload: { answers: [answer] },
        },
      ],
    ]);
  });
}

for (const width of [390, 1280]) {
  test(`Beautiful Chat is accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(
      page.getByText("How can I help you today?", { exact: true }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/beautiful-chat-${width}.png`,
      fullPage: true,
    });
  });
}
