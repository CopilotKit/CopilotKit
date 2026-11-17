import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// A2UI fixed schema. The flight card's component tree is authored ahead of
// time (12 nodes: root, content, title, route, from, arrow, to, meta,
// airline, price, bookButton, bookButtonLabel), and the agent only streams
// data into the data model. The custom renderers (Title, Airport, Arrow,
// AirlineBadge, PriceTag, Button) bind paths such as "/airline" and "/price"
// to that data.
//
// The assertions use the literal texts of the authored schema ("Flight
// Details", "Book flight"). They are constants, not data-model bindings, so
// they render even when the data model is missing.

describeDemo("a2ui-fixed-schema", "A2UI Fixed Schema (flight card)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("a2ui-fixed-schema"));
  });

  test("page loads with chat input and no flight card rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // "Flight Details" is the title literal of the flight schema. Before the
    // agent emits an A2UI operations container it must not be on the page;
    // if it is, a stale render or a schema leaked.
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

    // The title is a literal of the flight schema. On a cold start the
    // flight tool call and the operations round trip can take most of a
    // minute, so this allows 90s.
    await expect(page.getByText("Flight Details").first()).toBeVisible({
      timeout: 90_000,
    });

    // The Airport renderer shows the airport codes. SFO and JFK are in the
    // prompt, so the agent binds them verbatim.
    await expect(page.getByText("SFO").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("JFK").first()).toBeVisible({
      timeout: 10_000,
    });

    // The "Book flight" label is a literal of the schema. It shows that the
    // whole 12-node tree rendered, including the Button override.
    await expect(page.getByRole("button", { name: "Book flight" })).toBeVisible(
      { timeout: 10_000 },
    );

    // Exactly one flight card. An agent that does not see the tool result
    // as success calls the flight tool again and again, and duplicate cards
    // show that loop.
    const flightDetailsCount = await page.getByText("Flight Details").count();
    expect(flightDetailsCount).toBe(1);
    const bookButtons = await page
      .getByRole("button", { name: "Book flight" })
      .count();
    expect(bookButtons).toBe(1);

    // No A2UI render-error banners.
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
  });
});
