/**
 * Shared test helpers for E2E smoke tests.
 *
 * Used by both integration-smoke.spec.ts (showcase backends on Railway)
 * and starter-smoke.spec.ts (Docker-built starters with aimock).
 */

import type { APIRequestContext, Page, Response } from "@playwright/test";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  ok: boolean;
  status: number;
  path: string;
  body: string;
}

export interface AgentCheckResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface ChatResult {
  gotResponse: boolean;
  responseText: string;
  /**
   * AG-UI protocol outcome, captured from the /api/copilotkit SSE stream
   * rather than from the DOM.
   *
   * WHY (2026-09-14): `gotResponse` + `responseText.length > 0` is NOT a
   * success assertion. CopilotKit renders a `RUN_ERROR` as an assistant
   * message, so a run that failed outright satisfies both — which is how
   * llamaindex passed `starter-smoke` through 1345 consecutive failed probe
   * runs. Only the protocol transcript distinguishes "the agent answered"
   * from "the agent errored and the error was rendered as text".
   */
  agui: AguiOutcome;
}

export interface AguiOutcome {
  /** A terminal RUN_FINISHED was observed. */
  runFinished: boolean;
  /** A RUN_ERROR was observed (rendered in the UI as an assistant message). */
  runError: boolean;
  /** At least one non-empty TEXT_MESSAGE_CONTENT delta was streamed. */
  sawTextDelta: boolean;
  /**
   * The wait for an assistant message hit its timeout. Previously swallowed
   * by a bare `catch {}`, which turned a 60s hang into a "pass".
   */
  timedOut: boolean;
  /** Bytes of /api/copilotkit response body seen (0 == nothing captured). */
  transcriptBytes: number;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Probe the health endpoint(s) and return the first 200 response.
 *
 * Defaults to `/api/health` only — the standard Next.js convention used by
 * all deployed showcase backends and starters. Historically this helper also
 * fell back to `/health`, but every starter now mounts `/api/health` and the
 * fallback masked legitimate 5xx responses (a 503 "agent degraded" on
 * `/api/health` would be hidden behind the subsequent 404 from the non-
 * existent `/health`, reporting the misleading `path=/health` in failures).
 *
 * Callers that need to probe a different path (e.g. local Docker starters
 * with a custom health route) can pass an explicit `paths` array.
 *
 * Supports retries with delay for cold-start scenarios (e.g. Railway starters).
 */
export async function checkHealth(
  request: APIRequestContext,
  baseUrl: string,
  paths: string[] = ["/api/health"],
  retries: number = 0,
  retryDelayMs: number = 15_000,
): Promise<HealthCheckResult> {
  let lastResult: HealthCheckResult = {
    ok: false,
    status: 0,
    path: paths[0],
    body: "no attempts made",
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const path of paths) {
      try {
        const res = await request.get(`${baseUrl}${path}`, {
          timeout: 15_000,
        });
        if (res.ok()) {
          return {
            ok: true,
            status: res.status(),
            path,
            body: await res.text(),
          };
        }
        lastResult = {
          ok: false,
          status: res.status(),
          path,
          body: await res.text(),
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        lastResult = { ok: false, status: 0, path, body: msg };
      }
    }

    // If we have retries left, wait before the next attempt
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return lastResult;
}

// ---------------------------------------------------------------------------
// Agent endpoint check
// ---------------------------------------------------------------------------

/**
 * Check the CopilotKit runtime endpoint is reachable.
 * Tries GET on /info first, then falls back to POST on the base path.
 * Considers the endpoint OK when the response is 2xx-4xx (not 5xx or network error).
 */
export async function checkAgentEndpoint(
  request: APIRequestContext,
  baseUrl: string,
  agentPath: string = "/api/copilotkit",
): Promise<AgentCheckResult> {
  // Try GET /info first (CopilotKit runtime info endpoint — returns runtime
  // metadata on starters that support it). Then fall back to POST on the base
  // path. The key check is that we get ANY response from the CopilotKit runtime
  // (even a 404 from its internal Hono router) rather than a Next.js 404 page.
  const infoPaths = [`${agentPath}/info`, agentPath];

  for (const path of infoPaths) {
    try {
      const res = await request.get(`${baseUrl}${path}`, { timeout: 15_000 });
      const body = await res.text();
      // Accept 2xx as definitive success
      if (res.status() >= 200 && res.status() < 300) {
        return { ok: true, status: res.status(), body };
      }
      // A 405 "Method not allowed" proves the route exists (just wrong method)
      if (res.status() === 405) {
        return { ok: true, status: res.status(), body };
      }
    } catch {
      // try next path
    }
  }

  // Fall back to POST — the CopilotKit Hono router may return its own 404
  // for a bare POST (expects sub-path), but that still proves the runtime
  // is mounted. Distinguish from a Next.js 404 by checking for JSON body.
  try {
    const res = await request.post(`${baseUrl}${agentPath}`, {
      headers: { "Content-Type": "application/json" },
      data: { messages: [], tools: [], agentId: "agentic_chat" },
      timeout: 15_000,
    });
    const body = await res.text();
    const isRuntimeResponse = body.includes('"error"') || res.status() !== 404;
    return {
      ok: isRuntimeResponse,
      status: res.status(),
      body,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: msg };
  }
}

// ---------------------------------------------------------------------------
// Chat interaction
// ---------------------------------------------------------------------------

/** AG-UI frame types that carry streamed assistant text. */
const TEXT_DELTA_EVENTS: ReadonlySet<string> = new Set([
  // The START/CONTENT/END triple.
  "TEXT_MESSAGE_CONTENT",
  // The single-frame spelling; SDKs differ in which they emit, and matching
  // only CONTENT produced a false red on the .NET starter.
  "TEXT_MESSAGE_CHUNK",
]);

/**
 * True when the transcript carries at least one text frame with a non-empty
 * `delta`.
 *
 * PARSED PER FRAME, not pattern-matched across the transcript. This replaced a
 * pair of proximity regexes that required `"delta"` within 200 characters of
 * the event name. That held for compact frames but not for the langgraph
 * starters, which embed the full LangChain `rawEvent` blob BETWEEN the two
 * keys — measured at 1170 characters on `langgraph-fastapi`, so a completely
 * healthy run (`runFinished=true, runError=false, timedOut=false`, 633 KB of
 * transcript, visible assistant text) read as "no text emitted" and went red.
 * No window is the right window: a frame either has the key or it does not.
 *
 * Strictly stronger than the regex it replaces — the `delta` must belong to the
 * SAME frame as the text event type, where before any two nearby keys matched.
 */
function hasNonEmptyTextDelta(transcript: string): boolean {
  let parsedAnyFrame = false;
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    const payload = trimmed.startsWith("data:")
      ? trimmed.slice("data:".length).trim()
      : trimmed;
    if (!payload.startsWith("{")) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(payload);
    } catch {
      continue;
    }
    parsedAnyFrame = true;
    const { type, delta } = frame as { type?: unknown; delta?: unknown };
    if (
      typeof type === "string" &&
      TEXT_DELTA_EVENTS.has(type) &&
      typeof delta === "string" &&
      delta.length > 0
    ) {
      return true;
    }
  }
  // Fallback for a transport that is NOT line-delimited JSON (nothing in the
  // fleet emits one today). Only reachable when zero frames parsed, so it can
  // never loosen the framed check above.
  if (parsedAnyFrame) return false;
  const names = [...TEXT_DELTA_EVENTS].join("|");
  return new RegExp(`"(?:${names})"[\\s\\S]*?"delta"\\s*:\\s*"[^"]`).test(
    transcript,
  );
}

/**
 * Navigate to a page and interact with the chat.
 */
export async function sendChatMessage(
  page: Page,
  baseUrl: string,
  message: string,
  path: string = "/",
): Promise<ChatResult> {
  const url = `${baseUrl}${path}`;

  // Capture the AG-UI transcript off the wire. Attached before navigation so
  // nothing is missed. `response.text()` on an SSE body resolves when the
  // stream ends, so the promises are collected and awaited at the end.
  const bodyPromises: Promise<string>[] = [];
  const onResponse = (res: Response) => {
    if (!res.url().includes("/api/copilotkit")) return;
    bodyPromises.push(res.text().catch(() => ""));
  };
  page.on("response", onResponse);

  const agui: AguiOutcome = {
    runFinished: false,
    runError: false,
    sawTextDelta: false,
    timedOut: false,
    transcriptBytes: 0,
  };

  // Drains the captured SSE bodies and stamps the protocol outcome onto
  // whichever DOM-derived result the caller path produced.
  const finish = async (
    partial: Omit<ChatResult, "agui">,
  ): Promise<ChatResult> => {
    page.off("response", onResponse);
    // Bound the drain: if the agent hangs mid-stream, `res.text()` never
    // resolves. Cap it so the test reports a real assertion failure instead
    // of dying on Playwright's outer timeout with no diagnosis.
    const drained = await Promise.all(
      bodyPromises.map((p) =>
        Promise.race([
          p,
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(""), 15_000),
          ),
        ]),
      ),
    );
    const transcript = drained.join("\n");
    agui.transcriptBytes = transcript.length;
    agui.runError = transcript.includes("RUN_ERROR");
    agui.runFinished = transcript.includes("RUN_FINISHED");
    agui.sawTextDelta = hasNonEmptyTextDelta(transcript);
    return { ...partial, agui };
  };

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  // Wait for the chat UI to be ready — CopilotKit renders a textarea
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 15_000 });

  // Count existing messages before sending
  const messagesBefore = await page
    .locator('[data-testid="copilot-assistant-message"]')
    .count();

  // Type and send
  await textarea.fill(message);
  await textarea.press("Enter");

  // Wait for a new assistant message to appear
  try {
    await page.waitForFunction(
      ({ selector, countBefore }) => {
        const msgs = document.querySelectorAll(selector);
        return msgs.length > countBefore;
      },
      {
        selector: '[data-testid="copilot-assistant-message"]',
        countBefore: messagesBefore,
      },
      { timeout: 60_000 },
    );
  } catch {
    // RECORD the timeout — do not swallow it. A 60s hang followed by a
    // 5s grace period used to be indistinguishable from a working chat.
    // The grace period stays (some shells render without the testid), but
    // the caller now gets to see that the wait blew its deadline.
    agui.timedOut = true;
    await page.waitForTimeout(5_000);
  }

  // Extract the latest assistant message text, waiting for content to stream in
  const assistantMessages = page.locator(
    '[data-testid="copilot-assistant-message"]',
  );
  const count = await assistantMessages.count();
  if (count > messagesBefore) {
    const latest = assistantMessages.nth(count - 1);
    // Wait for the message to have non-empty text (streaming may still be in progress)
    try {
      await page.waitForFunction(
        (el) => (el?.textContent?.trim().length ?? 0) > 0,
        await latest.elementHandle(),
        { timeout: 60_000 },
      );
    } catch {
      // Streaming may be slow; continue with whatever we have
    }
    const text = (await latest.textContent()) ?? "";
    return finish({ gotResponse: true, responseText: text.trim() });
  }

  // Fallback: CopilotSidebar may not use data-testid="copilot-assistant-message".
  // Detect response by looking for new text content that appeared after our message.
  // The "Regenerate response" button appears next to assistant messages in the sidebar.
  const pageText = await page.locator("body").textContent();
  const userMsgIndex = pageText?.lastIndexOf(message) ?? -1;
  if (userMsgIndex >= 0) {
    const afterUserMsg = (pageText ?? "")
      .slice(userMsgIndex + message.length)
      .trim();
    // Filter out UI chrome text (buttons, labels) — look for substantial text
    const stripped = afterUserMsg
      .replace(/Regenerate response/g, "")
      .replace(/Copy to clipboard/g, "")
      .replace(/Thumbs (up|down)/g, "")
      .replace(/Powered by CopilotKit/g, "")
      .replace(/Type a message\.\.\./g, "")
      .replace(/\bSend\b/g, "")
      .trim();
    if (stripped.length > 20) {
      return finish({
        gotResponse: true,
        responseText: stripped.split("\n")[0].trim(),
      });
    }
  }

  return finish({ gotResponse: false, responseText: "" });
}

// ---------------------------------------------------------------------------
// Console error collector
// ---------------------------------------------------------------------------

/**
 * Attach listeners for console errors and page errors.
 * Returns an accessor to retrieve collected errors.
 */
export function setupConsoleErrorCollector(page: Page): {
  getErrors: () => string[];
} {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`[console.error] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  return { getErrors: () => [...errors] };
}
