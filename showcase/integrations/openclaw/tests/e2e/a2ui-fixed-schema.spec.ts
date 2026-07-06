import { test, expect } from "@playwright/test";

// Behavioral e2e for the a2ui-fixed-schema demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so the
// prompt matches the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// Pattern — A2UI Fixed Schema (flight card): the constrained component catalog
// (Card / Title / Airport / Arrow / AirlineBadge / PriceTag / Button, wired via
// `<CopilotKit a2ui={{ catalog }}>`) lives on the FRONTEND. OpenClaw's gateway
// is a pass-through with no A2UI backend, so the A2UI runtime middleware injects
// its generic `render_a2ui` tool and forwards the model's call. The fixture
// therefore emits `render_a2ui` directly with the FIXED flight component tree as
// `components` + a flight `data` model; the `{ path: "/origin" }` bindings
// resolve against that data, preserving fixed-schema semantics.
//
// clawg-ui flattens the AG-UI conversation into one user prompt, so aimock's
// role:"tool" (hasToolResult) discriminator never fires on the follow-up. The
// render_a2ui tool-call turn is gated on hasToolResult:false; the tool-result
// leg is closed by the shared `userMessage:"returned:"` TERMINATOR fixture
// (already in chat.json), which returns a plain-text completion so the loop
// ends. This spec asserts the FRONTEND rendering the fixture demonstrably drives.
//
// Verbatim text assertions ride on literals baked into the fixture's render_a2ui
// arguments, NOT data-model bindings that could leak a raw { path } object:
//   - "Flight Details"  → the Title text literal
//   - "Book flight"     → the bookButtonLabel Text literal
//   - "SFO" / "JFK"     → data-model values bound into the Airport renderers
// plus the demo's own testid on the card container (data-testid="a2ui-fixed-card").
test.describe("A2UI Fixed Schema (flight card)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("page loads with chat input and no flight card rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    // "Flight Details" is the Title literal. It must NOT be on the page before
    // the agent emits a render_a2ui surface — presence would indicate a stale
    // render or a schema leak.
    await expect(page.getByText("Flight Details")).toHaveCount(0);
    await expect(
      page.locator('[data-testid="a2ui-fixed-card"]'),
    ).toHaveCount(0);
  });

  test("the single starter suggestion renders", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Find SFO → JFK" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("suggestion pill renders a flight card matching the fixed schema", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Find SFO → JFK" }).click();

    // The render_a2ui fixture forwards the fixed flight surface. The card
    // container carries the demo's testid; its presence proves the frontend
    // catalog rendered the forwarded surface.
    await expect(
      page.locator('[data-testid="a2ui-fixed-card"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // Title text literal from the fixture's components tree.
    await expect(page.getByText("Flight Details").first()).toBeVisible({
      timeout: 10000,
    });

    // Airport codes are data-model values ("/origin" → SFO, "/destination" →
    // JFK) resolved by the GenericBinder into the Airport renderers.
    await expect(page.getByText("SFO").first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("JFK").first()).toBeVisible({
      timeout: 10000,
    });

    // Book-flight button label is the bookButtonLabel Text literal — presence
    // proves the full tree (down to the Button override) rendered.
    await expect(
      page.getByRole("button", { name: "Book flight" }),
    ).toBeVisible({ timeout: 10000 });

    // Regression guard: exactly ONE card / one book button after the round-trip.
    // Duplicates would mean the render_a2ui tool-call loop failed to terminate
    // (the "returned:" terminator did not close the turn).
    await expect(
      page.locator('[data-testid="a2ui-fixed-card"]'),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Book flight" }),
    ).toHaveCount(1);

    // Regression guard: no A2UI render-error banners (unbound { path } leak,
    // missing catalog, or untyped component).
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
    await expect(page.getByText(/object with keys/i)).toHaveCount(0);
  });
});
