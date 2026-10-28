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
  composerTimeoutMs = 90_000,
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
        const observedEvents = source.events;
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
  async function newThread({ scenarioId, mode = "rich", beforeRun }) {
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
    };
    threads.add(thread);
    await page.route(`**/agent/${scope.agentId}/run`, async (route) => {
      // Capture ownership before awaiting the hook; a later send cannot
      // replace the deadline authorizing this request.
      const admission = thread.admission;
      try {
        assert.ok(
          admission && !admission.claimed,
          "Run has no unique send admission",
        );
        admission.claimed = true;
        admission.check();
        await beforeRun?.(route.request().postDataJSON());
        admission.check();
        const continued = route.continue();
        admission.finish();
        await continued;
      } catch (error) {
        admission?.finish(error);
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
    url.searchParams.set("framework", scope.framework);
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
      assert.ok(!thread.admission, "A send is already awaiting admission");
      if (thread.error) throw thread.error;
      const previous = [...thread.runIds];
      const input = thread.page.getByTestId("copilot-chat-textarea");
      const send = thread.page.getByTestId("copilot-send-button");
      assert.ok(
        Number.isSafeInteger(composerTimeoutMs) && composerTimeoutMs > 0,
      );
      const deadline = Date.now() + composerTimeoutMs;
      const timeout = new AbortController();
      const actionSignal = signal
        ? AbortSignal.any([signal, timeout.signal])
        : timeout.signal;
      const timer = setTimeout(
        () => timeout.abort(new Error("Browser composer deadline exceeded")),
        composerTimeoutMs,
      );
      const options = () => {
        actionSignal.throwIfAborted();
        const remaining = deadline - Date.now();
        assert.ok(remaining > 0, "Browser composer deadline exceeded");
        return { timeout: remaining, signal: actionSignal };
      };
      let finish;
      const admitted = new Promise((resolve) => {
        finish = resolve;
      });
      const admission = { check: options, finish, claimed: false };
      thread.admission = admission;
      const aborted = () => finish(actionSignal.reason);
      actionSignal.addEventListener("abort", aborted, { once: true });
      try {
        // SSR exposes the composer before hydration and runtime discovery.
        // Hydration can erase an early fill; only prepare input until the UI
        // enables sending. Never repeat the actual submission. Playwright's
        // native signal cancels pending actions, preventing a late click.
        while (true) {
          if (thread.error) throw thread.error;
          await input.fill(prompt, options());
          if (await send.isEnabled(options())) break;
          await delay(Math.min(250, options().timeout), undefined, {
            signal: actionSignal,
          });
        }
        await send.click(options());
        const error = await admitted;
        if (error) throw error;
      } catch (error) {
        // A failed attempt cannot lend a fresh budget to a delayed request.
        thread.error = error;
        throw error;
      } finally {
        clearTimeout(timer);
        actionSignal.removeEventListener("abort", aborted);
        if (thread.admission === admission) delete thread.admission;
      }
      thread.interactions.push({ kind: "send" });
      return settled(thread, previous);
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
