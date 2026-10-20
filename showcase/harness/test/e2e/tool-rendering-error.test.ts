import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { expect, test } from "vitest";
import { z } from "zod";

const journalSchema = z.array(
  z.object({
    path: z.string(),
    body: z.object({
      messages: z.array(
        z.object({
          role: z.string(),
          content: z.string().nullable().optional(),
          tool_call_id: z.string().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      ),
    }),
    response: z.object({
      misbehavior: z
        .object({
          applied: z.boolean(),
          wire: z.string(),
          fault: z.string().optional(),
          reason: z.string().optional(),
          servedToolCalls: z
            .array(z.object({ arguments: z.string() }))
            .optional(),
        })
        .optional(),
    }),
  }),
);

function localUrl(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for this real local UI test`);
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(`${name} must use a loopback HTTP URL`);
  }
  return url;
}

const demoUrl = localUrl("SHOWCASE_TEST_URL");
const aimockUrl = localUrl("AIMOCK_URL");
const context = process.env.AIMOCK_CONTEXT;
if (!context) throw new Error("AIMOCK_CONTEXT is required");
const proofRoot =
  process.env.SHOWCASE_PROOF_DIR ??
  path.resolve("test-results/tool-rendering-error");

test.each([
  { width: 375, height: 667 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
])(
  "weather failure has a working retry at $width x $height",
  async (viewport) => {
    const testId = `weather-error-${randomUUID()}`;
    const directory = path.join(
      proofRoot,
      `${viewport.width}x${viewport.height}`,
    );
    await mkdir(directory, { recursive: true });
    const headers = {
      "x-test-id": testId,
      "x-aimock-context": `${context}:weather-error:${testId}`,
      "x-aimock-strict": "true",
    };
    const scopeUrl = new URL("/__aimock/misbehavior", aimockUrl);
    // Unique contexts keep these three bounded fixtures inert for other tests.
    // They live until this owned local aimock process is torn down; never clear
    // a shared fixture registry to clean up a single test.
    const fixtureContext = headers["x-aimock-context"];
    const fixtures = await fetch(new URL("/__aimock/fixtures", aimockUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fixtures: [
          {
            match: {
              context: fixtureContext,
              userMessage: "What is the weather in Tokyo?",
              toolName: "get_weather",
              hasToolResult: false,
            },
            response: {
              content: "Looking up the weather in Tokyo for you.",
              toolCalls: [
                { name: "get_weather", arguments: '{"location":"Tokyo"}' },
              ],
            },
          },
          {
            match: {
              context: fixtureContext,
              userMessage: "What is the weather in Tokyo?",
              hasToolResult: true,
              toolResultContains: '"city": "Tokyo"',
            },
            response: { content: "Tokyo is 68°F and sunny." },
          },
          {
            match: {
              context: fixtureContext,
              userMessage: "What is the weather in Tokyo?",
              hasToolResult: true,
              toolResultContains:
                "Error invoking tool 'get_weather' with kwargs {}",
            },
            response: {
              content:
                "The weather in Tokyo is currently 22°C with partly cloudy skies and light easterly winds.",
            },
          },
        ],
      }),
    });
    expect(fixtures.ok).toBe(true);
    const journalUrl = new URL("/__aimock/journal", aimockUrl);
    journalUrl.searchParams.set("testId", testId);
    const readJournal = async () => {
      const response = await fetch(journalUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      expect(response.ok).toBe(true);
      const raw: unknown = await response.json();
      await writeFile(
        path.join(directory, "journal.json"),
        JSON.stringify(raw, null, 2),
      );
      return journalSchema.parse(raw);
    };
    let browser: Browser | undefined;
    let browserContext: BrowserContext | undefined;
    let diagnosticPage: Page | undefined;
    let bodyFailed = false;
    const streams: Promise<void>[] = [];
    const cleanupErrors: unknown[] = [];
    try {
      const configured = await fetch(scopeUrl, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          faults: [{ fault: "tool-args-invalid-json", times: 1 }],
        }),
      });
      expect(configured.ok).toBe(true);
      browser = await chromium.launch({ headless: true });
      browserContext = await browser.newContext({
        viewport,
        extraHTTPHeaders: headers,
      });
      const page = await browserContext.newPage();
      diagnosticPage = page;
      page.on("response", (response) => {
        if (!response.url().includes("/api/copilotkit")) return;
        const index = streams.length;
        streams.push(
          response
            .text()
            .then((text) =>
              writeFile(path.join(directory, `response-${index}.txt`), text),
            )
            .catch((error: unknown) => {
              cleanupErrors.push(
                new Error(`Response capture ${index}: ${String(error)}`, {
                  cause: error,
                }),
              );
            }),
        );
      });
      await writeFile(path.join(directory, "test-id.txt"), testId);
      await page.goto(demoUrl.href, { waitUntil: "networkidle" });
      const composer = page.locator("textarea").first();
      await composer.fill("What is the weather in Tokyo?");
      await composer.press("Enter");
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "Weather lookup failed." });
      await expect.poll(() => alert.count(), { timeout: 20_000 }).toBe(1);
      expect(await alert.textContent()).toContain("Weather lookup failed.");
      const retry = page.getByRole("button", {
        name: "Retry",
        exact: true,
      });
      await expect.poll(() => retry.isEnabled()).toBe(true);
      expect(await page.locator('[data-testid="weather-card"]').count()).toBe(
        0,
      );
      expect(await page.locator("body").innerText()).not.toContain(
        "The weather in Tokyo is currently",
      );
      await page.screenshot({
        path: path.join(directory, "failure.png"),
        fullPage: true,
      });
      const failed = await readJournal();
      expect(failed).toHaveLength(1);
      expect(failed[0].path).toBe("/v1/chat/completions");
      const fault = failed[0].response.misbehavior;
      expect(fault).toMatchObject({
        applied: true,
        wire: "openai-chat",
        fault: "tool-args-invalid-json",
      });
      expect(fault?.servedToolCalls).toHaveLength(1);
      expect(() =>
        JSON.parse(fault?.servedToolCalls?.[0].arguments ?? "{}"),
      ).toThrow();
      await retry.click();
      await expect
        .poll(
          async () =>
            page.locator('[data-testid="weather-card"]').last().textContent(),
          { timeout: 20_000 },
        )
        .toContain("68");
      expect(
        await page.locator('[data-testid="weather-card"]').last().textContent(),
      ).toContain("Tokyo");
      await page.screenshot({
        path: path.join(directory, "retry.png"),
        fullPage: true,
      });
      await expect.poll(async () => (await readJournal()).length).toBe(3);
      const recovered = await readJournal();
      expect(
        recovered.filter((entry) => entry.response.misbehavior?.applied),
      ).toHaveLength(1);
      expect(recovered[1].response.misbehavior).toMatchObject({
        applied: false,
        reason: "times-exhausted",
      });
      expect(recovered[1].body.messages.at(-1)).toMatchObject({
        role: "user",
        content: "What is the weather in Tokyo?",
      });
      expect(
        recovered[1].body.messages.some(
          (message) =>
            message.role === "tool" &&
            message.content?.includes("Field required"),
        ),
      ).toBe(true);
      const toolResult = recovered[2].body.messages.at(-1);
      expect(toolResult?.role).toBe("tool");
      expect(JSON.parse(toolResult?.content ?? "null")).toEqual({
        city: "Tokyo",
        temperature: 68,
        humidity: 55,
        wind_speed: 10,
        conditions: "Sunny",
      });
      const retryCall = recovered[2].body.messages
        .flatMap((message) => message.tool_calls ?? [])
        .find((call) => call.id === toolResult?.tool_call_id);
      expect(retryCall?.function.name).toBe("get_weather");
      expect(JSON.parse(retryCall?.function.arguments ?? "null")).toEqual({
        location: "Tokyo",
      });
      expect(retryCall?.id).not.toBe(
        recovered[1].body.messages.find((message) => message.role === "tool")
          ?.tool_call_id,
      );
    } catch (error) {
      bodyFailed = true;
      throw error;
    } finally {
      const attempt = async (
        label: string,
        operation: () => Promise<unknown>,
        timeout = 5_000,
      ) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            operation(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Test cleanup timed out")),
                timeout,
              );
            }),
          ]);
        } catch (error) {
          cleanupErrors.push(new Error(label, { cause: error }));
        } finally {
          clearTimeout(timer);
        }
      };
      const page = diagnosticPage;
      if (page) {
        await attempt("Final screenshot", () =>
          page.screenshot({
            path: path.join(directory, "final.png"),
            fullPage: true,
            timeout: 5_000,
          }),
        );
        await attempt("Visible text", async () =>
          writeFile(
            path.join(directory, "visible.txt"),
            await page.locator("body").innerText({ timeout: 5_000 }),
          ),
        );
      }
      await attempt("Journal", readJournal);
      // Let complete responses finish before closing their transport.
      const captures = Promise.allSettled(streams);
      await attempt("Response captures before close", () => captures);
      await attempt("Browser context close", async () =>
        browserContext?.close(),
      );
      await attempt("Browser close", async () => browser?.close(), 15_000);
      await attempt("Response captures", () => captures);
      await attempt("Scope delete", async () => {
        const cleared = await fetch(scopeUrl, {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(5_000),
        });
        expect(cleared.ok).toBe(true);
      });
      if (bodyFailed && cleanupErrors.length) {
        const error = new AggregateError(
          cleanupErrors,
          "Weather test cleanup failed",
        );
        console.error(error);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        `Weather test cleanup failed: ${cleanupErrors.map(String).join("; ")}`,
      );
    }
  },
);
