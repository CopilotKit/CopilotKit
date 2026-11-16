import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  demoPath,
  describeDemo,
  integration,
  integrationDemoConfig,
} from "./helpers";

const RUNTIME_PATH = `/api/${integration}/agent-config`;
const TONE_SELECT = '[data-testid="agent-config-tone-select"]';
const EXPERTISE_SELECT = '[data-testid="agent-config-expertise-select"]';
const LENGTH_SELECT = '[data-testid="agent-config-length-select"]';
const ASSISTANT_MESSAGE = '[data-testid="copilot-assistant-message"]';

/**
 * Collects the body of every request that starts an agent run on this demo's
 * runtime. REST posts the run input to <runtime>/agent/<agent id>/run, and
 * the single route posts an `agent/run` envelope to <runtime> itself. Other
 * requests, such as `connect` and `stop`, carry no new config.
 */
function recordRunBodies(page: Page) {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const { pathname } = new URL(request.url());
    const body = request.postData() ?? "";
    const isRestRun =
      pathname.startsWith(`${RUNTIME_PATH}/agent/`) &&
      pathname.endsWith("/run");
    const isSingleRouteRun =
      pathname === RUNTIME_PATH && body.includes('"agent/run"');
    if (isRestRun || isSingleRouteRun) bodies.push(body);
  });
  return bodies;
}

interface RunInput {
  forwardedProps?: Record<string, unknown>;
}

interface SingleRouteEnvelope {
  method?: string;
  body?: RunInput;
}

// The forwardedProps of a recorded run body, in either transport.
function forwardedPropsOf(body: string) {
  const parsed: RunInput & SingleRouteEnvelope = JSON.parse(body);
  const input = parsed.method === "agent/run" ? parsed.body : parsed;
  return input?.forwardedProps;
}

async function send(page: Page, text: string) {
  const input = page.getByPlaceholder("Type a message");
  await input.fill(text);
  await input.press("Enter");
}

describeDemo("agent-config", "Agent Config Object", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("agent-config"));
  });

  test("page loads with config card and default dropdown values", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Agent Config" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-card"]'),
    ).toBeVisible();
    await expect(page.locator(TONE_SELECT)).toHaveValue("professional");
    await expect(page.locator(EXPERTISE_SELECT)).toHaveValue("intermediate");
    await expect(page.locator(LENGTH_SELECT)).toHaveValue("concise");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("changing a dropdown updates its DOM value immediately", async ({
    page,
  }) => {
    const toneSelect = page.locator(TONE_SELECT);
    await toneSelect.selectOption("enthusiastic");
    await expect(toneSelect).toHaveValue("enthusiastic");

    const expertiseSelect = page.locator(EXPERTISE_SELECT);
    await expertiseSelect.selectOption("expert");
    await expect(expertiseSelect).toHaveValue("expert");

    const lengthSelect = page.locator(LENGTH_SELECT);
    await lengthSelect.selectOption("detailed");
    await expect(lengthSelect).toHaveValue("detailed");
  });

  test("send produces an assistant response", async ({ page }) => {
    await send(page, "Hello");
    await expect(page.locator(ASSISTANT_MESSAGE).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("config object propagates to runtime requests", async ({ page }) => {
    const runBodies = recordRunBodies(page);

    await page.locator(TONE_SELECT).selectOption("enthusiastic");
    await page.locator(EXPERTISE_SELECT).selectOption("expert");
    await page.locator(LENGTH_SELECT).selectOption("detailed");
    await send(page, "Hello");

    await expect
      .poll(() => runBodies.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const payload = runBodies.join("\n");
    expect(payload).toContain("enthusiastic");
    expect(payload).toContain("expert");
    expect(payload).toContain("detailed");
  });

  test("changing config between sends produces distinct request payloads", async ({
    page,
  }) => {
    const runBodies = recordRunBodies(page);

    await send(page, "First");
    await expect(page.locator(ASSISTANT_MESSAGE).first()).toBeVisible({
      timeout: 30_000,
    });
    // Some backends end the stream a little after the assistant message
    // renders. Wait for the run to finish before the second send.
    await expect(page.locator('[data-copilot-running="false"]')).toBeVisible({
      timeout: 15_000,
    });
    const firstCount = runBodies.length;

    await page.locator(TONE_SELECT).selectOption("casual");
    await page.locator(LENGTH_SELECT).selectOption("detailed");
    await send(page, "Second");
    await expect
      .poll(() => runBodies.length, { timeout: 15_000 })
      .toBeGreaterThan(firstCount);

    const beforeChange = runBodies.slice(0, firstCount).join("\n");
    const afterChange = runBodies.slice(firstCount).join("\n");
    expect(beforeChange).toContain("professional");
    expect(beforeChange).toContain("concise");
    expect(afterChange).toContain("casual");
    expect(afterChange).toContain("detailed");
  });

  test("an agent that reads forwardedProps gets the config there", async ({
    page,
  }) => {
    const settings = await integrationDemoConfig<{
      readsForwardedProps: boolean;
    }>("agent-config");
    test.skip(
      settings?.readsForwardedProps !== true,
      `The ${integration} agent reads the config from the agent context.`,
    );
    const runBodies = recordRunBodies(page);

    await page.locator(TONE_SELECT).selectOption("enthusiastic");
    await send(page, "Hello");
    await expect
      .poll(() => runBodies.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    expect(forwardedPropsOf(runBodies[0])).toMatchObject({
      tone: "enthusiastic",
      expertise: "intermediate",
      responseLength: "concise",
    });
  });
});
