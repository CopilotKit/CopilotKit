import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

const UPDATE_COUNT = 50;
const UPDATE_INTERVAL_MS = 20;
const RESPONSE_DELAY_MS = 200;
const SCREENSHOT_DIR = process.env.THREAD_REFRESH_SCREENSHOT_DIR;
const RUN_LABEL = process.env.THREAD_REFRESH_RUN_LABEL ?? "regression";

const isTranscriptRequest = (request: Request): boolean =>
  request.method() === "GET" &&
  /\/threads\/[^/]+\/messages$/.test(new URL(request.url()).pathname);

/** Counts attempts, including canceled downloads, through the real host inspector. */
test("coalesces streaming transcript refreshes and eventually shows the last saved message", async ({
  page,
}) => {
  const attempts = new Set<Request>();
  const pending = new Set<Request>();
  let completed = 0;
  let canceled = 0;
  let maxBrowserInFlight = 0;
  let serverWorkInFlight = 0;
  let maxServerWorkInFlight = 0;
  const responseRevisions: number[] = [];

  page.on("request", (request) => {
    if (!isTranscriptRequest(request)) return;
    attempts.add(request);
    pending.add(request);
    maxBrowserInFlight = Math.max(maxBrowserInFlight, pending.size);
  });
  page.on("requestfinished", (request) => {
    if (!attempts.has(request)) return;
    completed += 1;
    pending.delete(request);
  });
  page.on("requestfailed", (request) => {
    if (!attempts.has(request)) return;
    canceled += 1;
    pending.delete(request);
  });

  await page.route("https://cdn.copilotkit.ai/notifications/**", (route) =>
    route.fulfill({ json: { schemaVersion: 1, notifications: [] } }),
  );
  await page.route("https://cdn.copilotkit.ai/inspector-hud/**", (route) =>
    route.fulfill({ json: { schemaVersion: 1, rules: [] } }),
  );
  await page.goto("/?scenario=pro-enabled-existing&reset=1");
  await expect(page.locator("body")).toHaveAttribute("data-lab-ready", "true");
  const inspector = page.locator("cpk-web-inspector");
  const details = inspector.locator("cpk-thread-details");
  await expect(details).toBeVisible();
  await expect.poll(() => completed).toBe(1);

  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${RUN_LABEL}-initial.png`,
    });
  }

  // A real response snapshots the persisted transcript when its query starts.
  // The simulated server keeps its 200 ms of work even if the browser aborts.
  await page.route("**/threads/*/messages", async (route) => {
    serverWorkInFlight += 1;
    maxServerWorkInFlight = Math.max(maxServerWorkInFlight, serverWorkInFlight);
    try {
      const revision = await page.evaluate(() =>
        Number(document.body.dataset.refreshChunk ?? "0"),
      );
      await new Promise((resolve) => setTimeout(resolve, RESPONSE_DELAY_MS));
      await route.fulfill({
        json: {
          messages: [
            {
              id: "persisted-transcript-checkpoint",
              role: "assistant",
              content: `Durable transcript through chunk ${revision}`,
            },
          ],
        },
      });
      responseRevisions.push(revision);
    } finally {
      serverWorkInFlight -= 1;
    }
  });

  const streamDurationMs = await details.evaluate(
    async (element, { updateCount, updateIntervalMs }) => {
      const threadDetails = element as HTMLElement & {
        threadId: string;
        thread: { agentId: string };
      };
      const host =
        document.querySelector<WebInspectorElement>("cpk-web-inspector");
      const agent = host?.core?.getAgent(threadDetails.thread.agentId);
      if (!agent)
        throw new Error("The lab's real core agent is not connected.");
      agent.threadId = threadDetails.threadId;
      const streamStartedAt = performance.now();
      for (let revision = 1; revision <= updateCount; revision += 1) {
        document.body.dataset.refreshChunk = String(revision);
        // setMessages notifies the same onMessagesChanged subscription as
        // streamed AG-UI message updates. No inspector internals are invoked.
        agent.setMessages([
          {
            id: "live-streaming-message",
            role: "assistant",
            content: `Live streaming chunk ${revision}`,
          },
        ]);
        await new Promise((resolve) => setTimeout(resolve, updateIntervalMs));
      }
      return performance.now() - streamStartedAt;
    },
    { updateCount: UPDATE_COUNT, updateIntervalMs: UPDATE_INTERVAL_MS },
  );

  await expect(
    details.getByText(`Durable transcript through chunk ${UPDATE_COUNT}`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => serverWorkInFlight).toBe(0);
  await expect.poll(() => pending.size).toBe(0);

  const metrics = {
    run: RUN_LABEL,
    updates: UPDATE_COUNT,
    updateIntervalMs: UPDATE_INTERVAL_MS,
    streamDurationMs,
    responseDelayMs: RESPONSE_DELAY_MS,
    requestsIncludingInitial: attempts.size,
    completed,
    canceled,
    maxBrowserInFlight,
    maxServerWorkInFlight,
    finalResponseRevision: responseRevisions.at(-1),
    finalSavedMessageVisible: true,
  };
  console.log(`THREAD_MESSAGE_REFRESH ${JSON.stringify(metrics)}`);
  await test.info().attach("thread-message-refresh-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${RUN_LABEL}-final.png` });
    await writeFile(
      `${SCREENSHOT_DIR}/${RUN_LABEL}-metrics.json`,
      `${JSON.stringify(metrics, null, 2)}\n`,
    );
  }

  // Browser timers can run late under CI load. Allow the initial request,
  // bounded refreshes during the measured stream, and one trailing refresh.
  expect(attempts.size).toBeLessThanOrEqual(
    2 + Math.ceil(streamDurationMs / 1_000),
  );
  expect(canceled).toBe(0);
  expect(maxBrowserInFlight).toBe(1);
  expect(maxServerWorkInFlight).toBe(1);
  expect(responseRevisions.at(-1)).toBe(UPDATE_COUNT);
});
