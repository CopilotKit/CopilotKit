/**
 * Shared test helpers for E2E smoke tests.
 *
 * Used by both integration-smoke.spec.ts (showcase backends on Railway)
 * and starter-smoke.spec.ts (Docker-built starters with aimock).
 */

import { type APIRequestContext, type Page } from "@playwright/test";

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
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Try multiple health endpoint paths, return the first that responds 200.
 * Supports retries with delay for cold-start scenarios (e.g. Railway starters).
 */
export async function checkHealth(
  request: APIRequestContext,
  baseUrl: string,
  paths: string[] = ["/api/health", "/health"],
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
    // Fallback: look for any new content that appeared after our message
    // This handles cases where the selector doesn't match
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
    return { gotResponse: true, responseText: text.trim() };
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
      return {
        gotResponse: true,
        responseText: stripped.split("\n")[0].trim(),
      };
    }
  }

  return { gotResponse: false, responseText: "" };
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
