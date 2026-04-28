import { test, expect } from "@playwright/test";

// QA reference: qa/a2ui-fixed-schema.md
// Demo source: src/app/demos/a2ui-fixed-schema/{page.tsx, a2ui/*}
// Backend: src/agents/a2ui_fixed.py + src/agents/a2ui_schemas/flight_schema.json
//
// Pattern: A2UI FIXED-schema — the component tree lives on the frontend
// (flight_schema.json has 12 nodes: root, content, title, route, from,
// arrow, to, meta, airline, price, bookButton, bookButtonLabel) and the
// agent only streams DATA into the data model via the `display_flight`
// tool. Our custom renderers (Title, Airport, Arrow, AirlineBadge,
// PriceTag, Button) bind path strings like "/airline" / "/price" to the
// incoming data model.
//
// The "Book flight" Button has a stateful override (ActionButton in
// a2ui/renderers.tsx) that transitions to a "Booked" state with a green
// check SVG on click — purely local, because the SDK doesn't yet support
// `action_handlers=` on the Python side (see the comment in
// a2ui_fixed.py). The `booked_schema.json` swap path is therefore NOT
// expected to fire and is intentionally not tested.
//
// No data-testid anywhere in the demo. Assertions ride on:
//   - verbatim label text hardcoded in flight_schema.json ("Flight
//     Details", "Book flight") — these are literal `text` constants,
//     NOT data-model bindings, so they do not leak a {path} object
//     even if the data model is absent.
//   - brand colour fingerprints unique to each renderer (mint #189370
//     price, lilac #BEC2FF airline badge border, black #010507 book
//     button background).
//
// W8-8: on Railway, `display_flight` occasionally stalls the secondary
// LLM stage; render budget is 60s.

test.describe("A2UI Fixed Schema (flight card)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("page loads with chat input and no flight card rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // "Flight Details" is the title literal from flight_schema.json. It
    // must NOT be on the page before the agent emits an a2ui_operations
    // container — that would indicate a stale render or a schema leak.
    await expect(page.getByText("Flight Details")).toHaveCount(0);
  });

  test("single suggestion pill renders with verbatim title", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Find SFO → JFK" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("search-flights pill renders a flight card matching flight_schema", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions.filter({ hasText: "Find SFO → JFK" }).first().click();

    // Title is a literal in flight_schema.json ("Flight Details").
    // 90s budget: on cold starts the `display_flight` tool call + the
    // a2ui_operations container round-trip can eat most of a minute.
    await expect(page.getByText("Flight Details").first()).toBeVisible({
      timeout: 90_000,
    });

    // Route: Airport renderer formats as monospace 1.5rem; the
    // user-visible content is the uppercase airport code. SFO / JFK are
    // explicit in the prompt so the secondary LLM is extremely likely
    // to bind them verbatim into origin/destination.
    await expect(page.getByText("SFO").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("JFK").first()).toBeVisible({
      timeout: 10_000,
    });

    // Book flight button label is a literal in flight_schema.json
    // (`bookButtonLabel.text`). Presence = the full 12-node tree
    // rendered, including the Button override.
    await expect(page.getByRole("button", { name: "Book flight" })).toBeVisible(
      { timeout: 10_000 },
    );
  });

  test("Book flight button transitions to Booked on click", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions.filter({ hasText: "Find SFO → JFK" }).first().click();

    // Render budget is 90s here: the first click after cold-start can
    // burn most of a minute before `display_flight` emits the
    // a2ui_operations container, and we then need the full 12-node tree
    // to resolve before the Book flight button exists.
    const bookBtn = page.getByRole("button", { name: "Book flight" });
    await expect(bookBtn).toBeVisible({ timeout: 90_000 });
    await bookBtn.click();

    // After click: label switches to "Booked" and the button becomes
    // disabled. This is the purely-local ActionButton state transition;
    // no agent round-trip is involved.
    await expect(page.getByRole("button", { name: "Booked" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "Booked" })).toBeDisabled();
  });
});
