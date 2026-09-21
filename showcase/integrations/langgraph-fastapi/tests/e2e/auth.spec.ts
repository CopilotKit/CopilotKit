import { runConversation } from "../../../../harness/src/probes/helpers/conversation-runner.js";
import { buildChatPlatformTurns } from "../../../../harness/src/probes/scripts/_pill-contracts-chat-platform.js";
// Existing scenarios are diagnostics; only the canonical pill test below is functional acceptance.
import { test, expect } from "@playwright/test";
import type { APIResponse } from "@playwright/test";

/**
 * Auth demo lifecycle. The demo defaults to UNAUTHENTICATED on first
 * paint and renders SignInCard. After sign-in, <CopilotKit> mounts with
 * the bearer header attached and the chat boots. After sign-out the
 * chat STAYS MOUNTED (now with no Authorization header) so the user can
 * actually watch the runtime reject an unauthenticated send — that is
 * the whole point of the demo. The AuthBanner flips between green
 * (authenticated) and amber (signed-out) variants. Only a full page
 * reload resets to the SignInCard first-paint state.
 */
test.describe("Diagnostic: Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("Diagnostic: page loads unauthenticated with SignInCard visible", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="auth-sign-in-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="auth-sign-in-button"]'),
    ).toBeEnabled();
    await expect(page.locator('[data-testid="auth-demo-token"]')).toBeVisible();
    // Chat surface and AuthBanner only render after the first sign-in.
    await expect(page.locator('[data-testid="auth-banner"]')).toHaveCount(0);
    await expect(page.getByPlaceholder("Type a message")).toHaveCount(0);
  });

  test("Diagnostic: signing in mounts the chat surface with AuthBanner", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();

    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "true");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed in",
    );
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeEnabled();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // SignInCard is gone once we're authenticated.
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toHaveCount(
      0,
    );
  });

  test("Diagnostic: authenticated send produces an assistant response", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello in one short sentence");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("Diagnostic: signing out flips the banner amber and keeps the chat surface mounted", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();

    await page.locator('[data-testid="auth-sign-out-button"]').click();

    // Banner flips to the amber variant. SignInCard does NOT come back —
    // the demo would never get to showcase the rejection if it did.
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-authenticated", "false");
    await expect(page.locator('[data-testid="auth-status"]')).toContainText(
      "Signed out",
    );
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="auth-sign-in-card"]')).toHaveCount(
      0,
    );
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("Diagnostic: unauthenticated send surfaces a 401 error without crashing the page", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();

    // After sign-out, the next send must surface the rejection — not
    // produce an assistant response and not white-screen the page.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Tell me a one-line joke");
    await input.press("Enter");

    const errorSurface = page.locator('[data-testid="auth-demo-error"]');
    await expect(errorSurface).toBeVisible({ timeout: 15000 });
    // Page chrome stays visible — no white-screen.
    await expect(page.locator('[data-testid="auth-banner"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]'),
    ).toHaveCount(0);
  });

  test("Diagnostic: re-signing in from the amber banner clears the error and resumes chat", async ({
    page,
  }) => {
    await page.locator('[data-testid="auth-sign-in-button"]').click();
    await expect(
      page.locator('[data-testid="auth-sign-out-button"]'),
    ).toBeVisible();
    await page.locator('[data-testid="auth-sign-out-button"]').click();
    await expect(
      page.locator('[data-testid="auth-authenticate-button"]'),
    ).toBeVisible();

    await page.locator('[data-testid="auth-authenticate-button"]').click();
    const banner = page.locator('[data-testid="auth-banner"]');
    await expect(banner).toHaveAttribute("data-authenticated", "true", {
      timeout: 5000,
    });
    await expect(page.locator('[data-testid="auth-demo-error"]')).toHaveCount(
      0,
    );

    // Chat is responsive again.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Give me a fun fact");
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  for (const ordering of [
    "before-reauth",
    "after-reauth",
    "after-reauth-and-signout",
  ] as const) {
    test(`a real delayed rejection belongs to its original auth session: ${ordering}`, async ({
      page,
    }) => {
      const handshake = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/copilotkit-auth/info") &&
          response.status() === 200,
      );
      await page.getByTestId("auth-sign-in-button").click();
      await handshake;
      const input = page.getByPlaceholder("Type a message");
      const runResponse = () =>
        page.waitForResponse(
          (response) =>
            response
              .url()
              .endsWith("/api/copilotkit-auth/agent/auth-demo/run") &&
            response.request().method() === "POST",
        );
      const firstResponse = runResponse();
      await input.fill("Say hello in one short sentence");
      await input.press("Enter");
      const first = await firstResponse;
      expect(first.status()).toBe(200);
      await first.body();
      const assistants = page.getByTestId("copilot-assistant-message");
      await expect(assistants).toHaveCount(1);
      const initialText = await assistants.first().innerText();
      await page.getByTestId("auth-sign-out-button").click();
      await expect(page.getByTestId("auth-banner")).toHaveAttribute(
        "data-authenticated",
        "false",
      );

      let held:
        | { response: APIResponse; authorization: string | undefined }
        | undefined;
      const { promise: responseGate, resolve: releaseResponse } =
        Promise.withResolvers<void>();
      const pattern = "**/api/copilotkit-auth/agent/auth-demo/run";
      await page.route(pattern, async (route) => {
        const authorization = (await route.request().allHeaders())
          .authorization;
        if (held || authorization) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        held = { response, authorization };
        await responseGate;
        await route.fulfill({ response });
      });
      try {
        const rejectionResponse = runResponse();
        await input.fill("Tell me a one-line joke");
        await input.press("Enter");
        await expect.poll(() => held !== undefined).toBe(true);
        if (!held)
          throw new Error("The real runtime response was not captured");
        expect(held.authorization).toBeUndefined();
        expect(held.response.status()).toBe(401);
        const originalBytes = await held.response.body();
        const error = page.getByTestId("auth-demo-error");
        if (ordering === "before-reauth") {
          releaseResponse();
          await rejectionResponse;
          await expect(error).toBeVisible();
          await expect(error).toContainText("HTTP 401");
        }
        await page.getByTestId("auth-authenticate-button").click();
        await expect(page.getByTestId("auth-banner")).toHaveAttribute(
          "data-authenticated",
          "true",
        );
        await expect(error).toHaveCount(0);
        if (ordering === "after-reauth-and-signout") {
          await page.getByTestId("auth-sign-out-button").click();
          await expect(page.getByTestId("auth-banner")).toHaveAttribute(
            "data-authenticated",
            "false",
          );
        }
        releaseResponse();
        const rejection = await rejectionResponse;
        expect(rejection.status()).toBe(401);
        expect(await rejection.body()).toEqual(originalBytes);
        // The empty composer stops offering cancellation when the run settles.
        await expect(page.getByTestId("copilot-send-button")).toBeDisabled();
        await expect(error).toHaveCount(0);
        await expect(assistants).toHaveCount(1);
        await expect(assistants.first()).toHaveText(initialText);
        if (ordering === "after-reauth-and-signout") {
          await page.getByTestId("auth-authenticate-button").click();
        }
        const resumedResponse = runResponse();
        await input.fill("Give me a fun fact");
        await input.press("Enter");
        const resumed = await resumedResponse;
        expect(resumed.status()).toBe(200);
        const wire = await resumed.text();
        expect(wire).toContain('"type":"RUN_FINISHED"');
        await expect(assistants).toHaveCount(2);
        await expect(assistants.first()).toHaveText(initialText);
        await expect(error).toHaveCount(0);
      } finally {
        releaseResponse();
        await page.unroute(pattern);
      }
    });
  }
});

test("Canonical pill acceptance: auth", async ({ page }) => {
  await page.goto("/demos/auth");
  const result = await runConversation(page, buildChatPlatformTurns("auth"), {
    mode: "functional-pill",
    surface: "direct-diagnostic",
  });
  expect(result.error, JSON.stringify(result.pillExecution)).toBeUndefined();
  expect(result.pillExecution?.completed).toBe(true);
});
