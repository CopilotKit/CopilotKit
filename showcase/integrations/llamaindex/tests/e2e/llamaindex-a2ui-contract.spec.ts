import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// LlamaIndex runtime contract for FAC-237. The feature probe stays shared.
test.describe("LlamaIndex A2UI runtime contract", () => {
  test.setTimeout(120_000);

  for (const route of [
    "copilotkit-declarative-gen-ui",
    "copilotkit-a2ui-fixed-schema",
  ]) {
    test(`${route} watches the backend render tool without injecting it`, () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api", route, "route.ts"),
        "utf8",
      );
      expect(source).toMatch(/injectA2UITool:\s*false\b/);
      expect(source).toMatch(/a2uiToolNames:\s*\["render_a2ui"\]/);
    });
  }

  for (const { prompt, fixtureCallId } of [
    {
      prompt: "Show me my sales dashboard for this quarter.",
      fixtureCallId: "call_d6_decl_dash_outer_llamaindex_001",
    },
    {
      prompt: "Draw a sales dashboard",
      fixtureCallId: "call_fac237_lower_generate",
    },
    {
      prompt: "Draw a sales Dashboard",
      fixtureCallId: "call_fac237_title_generate",
    },
  ]) {
    test(`dashboard renders through the LlamaIndex backend generator: ${prompt}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          /A2UI render|Catalog not found|RUN_ERROR|tool.result/i.test(
            message.text(),
          )
        ) {
          errors.push(message.text());
        }
      });
      const streams: Promise<string>[] = [];
      page.on("response", (response) => {
        if (
          response.url().includes("/api/copilotkit-declarative-gen-ui") &&
          response.request().method() === "POST"
        ) {
          streams.push(response.text());
        }
      });
      await page.goto("/demos/declarative-gen-ui");
      const input = page.locator('[data-testid="copilot-chat-textarea"]');
      await input.fill(prompt);
      await input.press("Enter");
      await expect(
        page.locator('[data-testid="declarative-metric"]'),
      ).toHaveCount(4, { timeout: 90_000 });
      await expect(
        page.locator('[data-testid="declarative-pie-chart"]'),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-testid="declarative-bar-chart"]'),
      ).toHaveCount(1);
      await expect(page.getByText(/Building Interface/i)).toHaveCount(0);
      const events = (await Promise.all(streams)).find((body) =>
        body.includes('"type":"RUN_STARTED"'),
      );
      expect(events).toBeDefined();
      expect(events).toContain('"toolCallName":"generate_a2ui"');
      expect(events).toContain('"toolCallName":"render_a2ui"');
      expect(events).toContain(fixtureCallId);
      expect(events).toContain('"type":"RUN_FINISHED"');
      expect(events).not.toContain('"type":"RUN_ERROR"');
      const parsedEvents = events!
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)));
      const renderCalls = parsedEvents.filter(
        (event) =>
          event.type === "TOOL_CALL_START" &&
          event.toolCallName === "render_a2ui",
      );
      expect(renderCalls).toHaveLength(1);
      const renderCall = renderCalls[0];
      expect(renderCall.toolCallId).toMatch(/^render_a2ui-[0-9a-f]{32}$/);
      const args = parsedEvents
        .filter(
          (event) =>
            event.type === "TOOL_CALL_ARGS" &&
            event.toolCallId === renderCall.toolCallId,
        )
        .map((event) => event.delta)
        .join("");
      expect(Array.isArray(JSON.parse(args).components)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
});
