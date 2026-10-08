import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Real Playwright browser interactions shared by all row adapters. */
export async function createBrowser({
  chromium,
  scope,
  outputDir,
  capture,
  signal,
  instance,
}) {
  const browser = instance ?? (await chromium.launch({ headless: true }));
  const threads = new Set();
  async function snapshot(thread) {
    const name = `${thread.scenarioId}/browser-${thread.screenshots.length + 1}.png`;
    await mkdir(join(outputDir, thread.scenarioId), { recursive: true });
    await thread.page.screenshot({
      path: join(outputDir, name),
      fullPage: true,
    });
    thread.screenshots.push(name);
    const surfaces = await thread.page.locator("body").evaluate((body) => ({
      charts: [...body.querySelectorAll(".recharts-wrapper")].map((node) => ({
        text: node.textContent,
        svg: node.querySelector("svg")?.outerHTML,
      })),
      frames: [...body.querySelectorAll("iframe")].map((node) => ({
        title: node.title,
        src: node.getAttribute("src"),
        srcdoc: node.getAttribute("srcdoc"),
      })),
      media: [...body.querySelectorAll("img,video,audio,source")].map(
        (node) => ({
          tag: node.tagName,
          src: node.getAttribute("src"),
          alt: node.getAttribute("alt"),
          type: node.getAttribute("type"),
        }),
      ),
      controls: [...body.querySelectorAll("button")].map((node) => ({
        text: node.textContent,
        disabled: node.disabled,
        label: node.getAttribute("aria-label"),
      })),
      native: [
        ...body.querySelectorAll('[data-testid="native-interrupt"]'),
      ].map((node) => ({
        id: node.getAttribute("data-interrupt-id"),
        payload: node.querySelector("pre")?.textContent,
      })),
    }));
    return {
      threadId: thread.threadId,
      url: thread.page.url(),
      text: await thread.page.locator("body").innerText(),
      screenshots: [...thread.screenshots],
      interactions: [...thread.interactions],
      fresh: thread.fresh,
      surfaces,
    };
  }
  async function settled(thread, previousRunIds = []) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (thread.error) throw thread.error;
      if (thread.threadId) {
        const source = await capture.read(thread.threadId);
        const observedEvents = thread.nativeOnly
          ? source.frameworkRuns.flatMap((run) =>
              run.events.map((event) => ({
                ...event,
                runId: event.runId ?? run.input.runId,
              })),
            )
          : source.events;
        const started = observedEvents.filter(
          (event) =>
            event.type === "RUN_STARTED" &&
            !previousRunIds.includes(event.runId),
        );
        const terminal = observedEvents.filter((event) =>
          ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        );
        if (
          started.length &&
          started.every((start) =>
            terminal.some((end) => end.runId === start.runId),
          )
        )
          return source;
      }
      await delay(250, undefined, { signal });
    }
    await snapshot(thread);
    throw new Error(
      "Browser action did not produce a captured terminal run within 180s",
    );
  }
  async function newThread({
    scenarioId,
    mode = "rich",
    beforeRun,
    nativeOnly = false,
  }) {
    assert.match(scenarioId, /^[a-z0-9-]+$/);
    const context = await browser.newContext();
    const page = await context.newPage();
    const thread = {
      context,
      page,
      scenarioId,
      threadId: undefined,
      fresh: false,
      screenshots: [],
      interactions: [],
      runIds: [],
      nativeOnly,
    };
    threads.add(thread);
    await page.route(`**/agent/${scope.agentId}/run`, async (route) => {
      try {
        await beforeRun?.(route.request().postDataJSON());
        await route.continue();
      } catch (error) {
        thread.error = error;
        await route.abort();
      }
    });
    page.on("request", (request) => {
      if (
        !request.url().includes(`/agent/${scope.agentId}/run`) ||
        request.method() !== "POST"
      )
        return;
      try {
        const input = request.postDataJSON();
        assert.ok(input.threadId, "Browser run omitted thread identity");
        if (!thread.threadId) {
          assert.ok(
            input.messages?.length &&
              input.messages.every(
                (message) =>
                  message.role === "user" || message.role === "system",
              ),
            "New browser conversation contains prior assistant/tool history",
          );
          thread.threadId = input.threadId;
          thread.fresh = true;
        } else
          assert.equal(
            input.threadId,
            thread.threadId,
            "Browser changed thread during scenario",
          );
        thread.runIds.push(input.runId);
      } catch (error) {
        thread.error = error;
      }
    });
    const url = new URL(scope.applicationUrl);
    assert.match(mode, /^[a-z][a-z0-9-]+$/);
    url.searchParams.set("mode", mode);
    if (nativeOnly) url.searchParams.set("nativeOnly", "true");
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });
    await page
      .locator("textarea")
      .waitFor({ state: "visible", timeout: 90_000 });
    return thread;
  }
  return {
    newThread,
    snapshot,
    async send(thread, prompt) {
      const previous = [...thread.runIds];
      await thread.page.locator("textarea").fill(prompt);
      await thread.page.locator("textarea").press("Enter");
      return settled(thread, previous);
    },
    async upload(thread, files) {
      await thread.page.locator('input[type="file"]').setInputFiles(files);
    },
    async interact(thread, action) {
      const previous = [...thread.runIds];
      const root = action.frame
        ? thread.page.frameLocator(action.frame)
        : thread.page;
      const target = root.getByRole(action.role ?? "button", {
        name: action.name,
        exact: true,
      });
      const nativeControl =
        action.category === "native-completed"
          ? await target.evaluate((node) => {
              const surface = node.closest('[data-testid="native-interrupt"]');
              return {
                controlId: surface?.getAttribute("data-interrupt-id"),
                payload: surface?.querySelector("pre")?.textContent,
              };
            })
          : undefined;
      await target.click({ timeout: 60_000 });
      thread.interactions.push({
        ...action,
        ...nativeControl,
        at: new Date().toISOString(),
      });
      if (action.continuesRun) await settled(thread, previous);
      return snapshot(thread);
    },
    async openThread(
      threadId,
      { scenarioId = "reopened", mode = "rich" } = {},
    ) {
      const thread = await newThread({ scenarioId, mode });
      // The shared application exposes a test-only selection button wired to
      // the actual thread-selection API, not a fabricated conversation store.
      await thread.page.getByTestId("open-thread-id").fill(threadId);
      await thread.page.getByTestId("open-thread").click();
      thread.threadId = threadId;
      thread.fresh = false;
      return thread;
    },
    async reload(thread) {
      await thread.page.reload({ waitUntil: "domcontentloaded" });
      return snapshot(thread);
    },
    async closeThread(thread) {
      await thread.context.close();
      threads.delete(thread);
    },
    async close() {
      try {
        await Promise.all([...threads].map((thread) => thread.context.close()));
      } finally {
        if (!instance) await browser.close();
      }
    },
  };
}
