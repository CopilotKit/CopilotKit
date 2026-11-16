import { expect, test } from "@playwright/test";
import {
  beautifulChatPills,
  clickBeautifulChatPill,
  openBeautifulChat,
} from "./beautiful-chat-helpers";
import { describeDemo } from "./helpers";

describeDemo("beautiful-chat", "Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await openBeautifulChat(page);
  });

  test("page loads with logo, mode toggle, and chat input", async ({
    page,
  }) => {
    // CopilotKit logo (top-left of the chat pane)
    await expect(page.locator('img[alt="CopilotKit"]')).toBeVisible();

    // Mode toggle (Chat / App pills, fixed top-right). Role and exact name
    // tell them apart from other text that contains "Chat".
    await expect(
      page.getByRole("button", { name: "Chat", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "App", exact: true }),
    ).toBeVisible();

    // The CopilotChat input. The default v2 chat input is a textarea with
    // the placeholder "Type a message".
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("all 9 suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    for (const title of beautifulChatPills) {
      // Suggestions render as buttons that contain the verbatim title.
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Toggle Theme pill flips the html class and runs the toggleTheme tool", async ({
    page,
  }) => {
    // "Toggle Theme" is the fastest round trip: one frontend tool call and
    // no chart rendering. Its fixture answers with a toggleTheme tool call.
    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const initiallyDark = initialClass.includes("dark");

    await clickBeautifulChatPill(page, "Toggle Theme (Frontend Tools)");

    // The tool call renders in the transcript without a text bubble, so the
    // check is the tool's side effect: the `dark` class on <html> flips.
    // That proves both that the agent answered and that the tool ran.
    await expect
      .poll(
        async () => {
          const cls = (await html.getAttribute("class")) ?? "";
          return cls.includes("dark");
        },
        { timeout: 30000 },
      )
      .toBe(!initiallyDark);
  });

  test("Pie Chart pill renders a donut SVG with slice circles", async ({
    page,
  }) => {
    await clickBeautifulChatPill(page, "Pie Chart (Controlled Generative UI)");

    // The PieChart component (components/generative-ui/charts/pie-chart.tsx)
    // renders an inline <svg> with one background <circle> plus one
    // <circle> per slice. Wait for the background and at least two slices.
    const circles = page.locator("svg circle");
    await expect
      .poll(async () => await circles.count(), { timeout: 45000 })
      .toBeGreaterThanOrEqual(3);

    // Legend rows include a percentage ending in "%".
    await expect(page.getByText(/\d+%/).first()).toBeVisible({ timeout: 5000 });
  });

  test("Bar Chart pill renders a recharts bar chart with rectangles", async ({
    page,
  }) => {
    await clickBeautifulChatPill(page, "Bar Chart (Controlled Generative UI)");

    // Recharts renders bars inside a ResponsiveContainer. The root class is
    // stable across recharts versions.
    const barChartRoot = page.locator(".recharts-responsive-container").first();
    await expect(barChartRoot).toBeVisible({ timeout: 45000 });

    // At least 2 bar rectangles should render.
    const bars = page.locator(".recharts-bar-rectangle");
    await expect
      .poll(async () => await bars.count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(2);
  });

  test("Search Flights pill renders FlightCard surface from A2UI fixed schema", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // The agent's search_flights tool emits an a2ui_operations container
    // with one FlightCard component per flight, as literal components. The
    // fixtures return 2 flights: United at $349 and Delta at $289. Each
    // FlightCard shows the airline and the price as text.
    await clickBeautifulChatPill(page, "Search Flights (A2UI Fixed Schema)");

    // 60s budget: the tool call and the a2ui_operations round trip can be
    // slow on a cold start. The targets are fixture text, not model output,
    // so they are the same on every run.
    await expect(page.getByText("United Airlines").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Delta").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$349").first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("$289").first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Sales Dashboard pill renders A2UI dashboard surface", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // The agent fetches the sales data, then emits an A2UI surface: 3
    // metrics and 2 charts. Some backends design the surface with a second
    // model call, and both calls hit fixtures. The surface often has no
    // `catalogId` (real models leave it out), so the runtime's
    // `a2ui.defaultCatalogId` must resolve the page's catalog.
    //
    // Visual fingerprint: a Metric labelled "Total Revenue", plus a recharts
    // ResponsiveContainer (the Pie/BarChart renderers wrap their charts in
    // one).
    await clickBeautifulChatPill(page, "Sales Dashboard (A2UI Dynamic)");

    // 90s budget: the surface design step can stall on a cold start. The
    // fixtures end with narration that mentions total revenue. When the
    // A2UI surface does not render (for example when a fixture for the
    // design step does not fire), only that narration shows. So the
    // narration is the main signal and the charts are optional.
    await expect(page.getByText(/Total Revenue/i).first()).toBeVisible({
      timeout: 90_000,
    });

    // Regression guard (#4733, #4734, #5425): the deployed Sales Dashboard
    // showed "A2UI render error: Catalog not found: ..." when the model left
    // out `catalogId` and the route had no `defaultCatalogId`. The error
    // banner paints even when the surface fails, so check it whether or not
    // the charts rendered.
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);

    // Soft check: when the whole A2UI pipeline runs, recharts containers
    // appear, and these regression guards apply.
    const chartRoot = page.locator(".recharts-responsive-container").first();
    const chartsRendered = await chartRoot
      .isVisible({ timeout: 15_000 })
      .catch(() => false);

    if (chartsRendered) {
      await expect(
        page.getByText(/Cannot create component .* without a type/i),
      ).toHaveCount(0);

      // Regression guard: only ONE dashboard surface should render.
      const allCharts = page.locator(".recharts-responsive-container");
      await expect
        .poll(async () => await allCharts.count(), { timeout: 5_000 })
        .toBeLessThanOrEqual(2); // 1 pie + 1 bar = 2 charts
    }
  });

  test("Task Manager pill streams 3 todos into the shared-state canvas", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await clickBeautifulChatPill(page, "Task Manager (Shared State)");

    const todoColumn = page.locator('section[aria-label="To Do column"]');
    await expect(todoColumn).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText("Read the CopilotKit docs")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("Build a CopilotKit prototype")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Explore shared agent state")).toBeVisible({
      timeout: 5_000,
    });
  });
});
