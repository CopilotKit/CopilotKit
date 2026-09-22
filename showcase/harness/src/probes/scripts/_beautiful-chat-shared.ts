/** Complete nine-action acceptance contract for the public beautiful-chat route. */
import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  BEAUTIFUL_INVENTORY,
  BEAUTIFUL_BAR_VALUES,
  BEAUTIFUL_ROUTE_ACTIONS,
} from "./_pill-contracts-beautiful-headless.js";

export const FIRST_SIGNAL_TIMEOUT_MS = 60_000;
export const SIBLING_TIMEOUT_MS = 5_000;
export function preNavigateBeautifulChat(): string {
  return "/demos/beautiful-chat";
}

export async function readIsHtmlDark(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const { document } = globalThis as typeof globalThis & {
      document: {
        documentElement: { classList: { contains(value: string): boolean } };
      };
    };
    return document.documentElement.classList.contains("dark");
  });
}

export async function assertBeautifulInventory(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="copilot-suggestion"]', {
    state: "visible",
    timeout: 15_000,
  });
  const actual = await page.evaluate(() => {
    const { document } = globalThis as typeof globalThis & {
      document: {
        querySelectorAll(
          selector: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    return Array.from(
      document.querySelectorAll('[data-testid="copilot-suggestion"]'),
      (node) => (node.textContent ?? "").trim(),
    );
  });
  if (JSON.stringify(actual) !== JSON.stringify(BEAUTIFUL_INVENTORY))
    throw new Error(
      `beautiful-chat: canonical pill inventory mismatch: ${JSON.stringify(actual)}`,
    );
}

/** Each literal must be a visible descendant of the specific rendered widget. */
export async function assertVisibleValues(
  page: Page,
  selector: string,
  values: readonly string[],
): Promise<void> {
  await page.waitForSelector(selector, {
    state: "visible",
    timeout: FIRST_SIGNAL_TIMEOUT_MS,
  });
  for (const value of values) {
    await page.waitForSelector(`${selector} >> text=${JSON.stringify(value)}`, {
      state: "visible",
      timeout: SIBLING_TIMEOUT_MS,
    });
  }
}

export async function assertToggleTheme(
  page: Page,
  initiallyDark: boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  do {
    if ((await readIsHtmlDark(page)) !== initiallyDark) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(
    `beautiful-chat-toggle-theme: html.dark did not change from ${initiallyDark}; narration is not a theme change`,
  );
}

export async function assertPieChart(page: Page): Promise<void> {
  const card = "div.max-w-lg:has(svg circle)";
  await assertVisibleValues(page, card, ["Revenue by Category"]);
  for (const [label, value, percent] of [
    ["Electronics", "42,000", "42%"],
    ["Clothing", "28,000", "28%"],
    ["Food", "18,000", "18%"],
    ["Books", "12,000", "12%"],
  ]) {
    await assertVisibleValues(
      page,
      `${card} div.flex.items-center.gap-3:has(> span:text-is(${JSON.stringify(label)}))`,
      [label!, value!, percent!],
    );
  }
  const count = await page.evaluate(() => {
    const { document } = globalThis as typeof globalThis & {
      document: { querySelectorAll(selector: string): { length: number } };
    };
    return document.querySelectorAll("div.max-w-lg svg circle").length;
  });
  if (count !== 5)
    throw new Error(
      `beautiful-chat-pie-chart: expected background plus all 4 slices, got ${count}`,
    );
  for (let index = 0; index < 5; index++) {
    await page.waitForSelector(`${card} svg circle >> nth=${index}`, {
      state: "visible",
      timeout: SIBLING_TIMEOUT_MS,
    });
  }
  const proportions = await page.evaluate(() => {
    const { document } = globalThis as typeof globalThis & {
      document: {
        querySelectorAll(
          selector: string,
        ): ArrayLike<{ getAttribute(name: string): string | null }>;
      };
    };
    return Array.from(
      document.querySelectorAll("div.max-w-lg svg circle[stroke-dasharray]"),
      (circle) => {
        const lengths = (circle.getAttribute("stroke-dasharray") ?? "")
          .split(/[, ]+/)
          .map(Number);
        return lengths[0]! / (lengths[0]! + lengths[1]!);
      },
    );
  });
  const expected = [0.42, 0.28, 0.18, 0.12];
  if (
    proportions.length !== expected.length ||
    proportions.some(
      (value, index) =>
        !Number.isFinite(value) || Math.abs(value - expected[index]!) > 0.00001,
    )
  ) {
    throw new Error(
      `beautiful-chat-pie-chart: visible arcs do not match canonical legend values: ${JSON.stringify(proportions)}`,
    );
  }
}

export async function assertBarValues(
  page: Page,
  selector: string,
  expected: readonly { label: string; value: number }[],
  index = 0,
  kind: "bar" | "pie" = "bar",
): Promise<void> {
  if (!page.hover)
    throw new Error("canonical chart values require real page.hover");
  const mark =
    kind === "bar" ? ".recharts-bar-rectangle" : ".recharts-pie-sector";
  await page.waitForSelector(`${selector} >> nth=${index} >> ${mark}`, {
    state: "visible",
    timeout: FIRST_SIGNAL_TIMEOUT_MS,
  });
  const count = await page.evaluate(
    (scope) => {
      const { document } = globalThis as typeof globalThis & {
        document: {
          querySelectorAll(selector: string): ArrayLike<{
            querySelectorAll(selector: string): { length: number };
          }>;
        };
      };
      const charts = document.querySelectorAll(scope!.selector);
      return charts[scope!.index]?.querySelectorAll(scope!.mark).length ?? 0;
    },
    { selector, index, mark },
  );
  if (count !== expected.length)
    throw new Error(
      `canonical chart expected ${expected.length} bars, got ${count}`,
    );
  for (let i = 0; i < expected.length; i++) {
    await page.hover(`${selector} >> nth=${index} >> ${mark} >> nth=${i}`);
    await assertVisibleValues(
      page,
      `${selector} >> nth=${index} >> .recharts-tooltip-wrapper`,
      [expected[i]!.label, String(expected[i]!.value)],
    );
  }
}

export async function assertBarChart(page: Page): Promise<void> {
  await assertVisibleValues(page, "div.max-w-2xl:has(.recharts-wrapper)", [
    "Expenses by Category",
  ]);
  await assertBarValues(page, ".recharts-wrapper", BEAUTIFUL_BAR_VALUES);
}

export async function assertSearchFlights(page: Page): Promise<void> {
  // Card root has an airline logo in its header and a direct flight-number row.
  // Requiring each complete card preserves airline/price/route associations.
  for (const flight of [
    {
      airline: "United Airlines",
      number: "UA231",
      price: "$349",
      departure: "08:00",
      arrival: "16:30",
    },
    {
      airline: "Delta",
      number: "DL412",
      price: "$289",
      departure: "10:15",
      arrival: "18:45",
    },
  ]) {
    const card = `div:has(> div > div > img[alt=${JSON.stringify(flight.airline)}]):has(> hr)`;
    await assertVisibleValues(page, card, [
      flight.airline,
      flight.number,
      flight.price,
      "SFO",
      "JFK",
      "Tue, May 6",
      flight.departure,
      flight.arrival,
      "5h 30m",
      "On Time",
    ]);
  }
}

export async function assertScheduleMeeting(page: Page): Promise<void> {
  const card = 'div.max-w-md:has(h3:text-is("Learn about CopilotKit"))';
  await assertVisibleValues(page, card, [
    "Learn about CopilotKit",
    "Pick a time that works for you",
  ]);
  for (const name of [
    "Tomorrow 2:00 PM 30 min",
    "Friday 10:00 AM 30 min",
    "Next Monday 3:00 PM 30 min",
    "None of these work",
  ]) {
    const button = page.getByRole?.("button", { name, exact: true });
    if (
      !button ||
      (await button.count()) !== 1 ||
      !(await button.isVisible()) ||
      !(await button.isEnabled())
    )
      throw new Error(`meeting: missing enabled canonical control ${name}`);
  }
  await page.getByRole!("button", {
    name: "Tomorrow 2:00 PM 30 min",
    exact: true,
  }).click();
  await assertVisibleValues(
    page,
    'div.max-w-md:has(h3:text-is("Meeting Scheduled"))',
    ["Meeting Scheduled", "Tomorrow at 2:00 PM", "30 min"],
  );
}

export async function assertSalesDashboard(page: Page): Promise<void> {
  for (const [label, value, trend] of [
    ["Total Revenue", "$1.2M", "↑ +12% MoM"],
    ["New Customers", "342", "↑ +8% MoM"],
    ["Conversion Rate", "4.2%", ""],
  ]) {
    const metric = `div:has(> span:text-is(${JSON.stringify(label)})):has(> div > span)`;
    await assertVisibleValues(page, metric, [
      label!,
      value!,
      ...(trend ? [trend] : []),
    ]);
  }
  await assertBarValues(
    page,
    ".recharts-wrapper:has(.recharts-pie-sector)",
    [
      { label: "Electronics", value: 42000 },
      { label: "Clothing", value: 28000 },
      { label: "Food", value: 18000 },
      { label: "Books", value: 12000 },
    ],
    0,
    "pie",
  );
  await assertBarValues(
    page,
    ".recharts-wrapper:has(.recharts-bar-rectangle)",
    [
      { label: "Jan", value: 50000 },
      { label: "Feb", value: 62000 },
      { label: "Mar", value: 58000 },
      { label: "Apr", value: 71000 },
      { label: "May", value: 80000 },
      { label: "Jun", value: 92000 },
    ],
  );
}

export async function assertTaskManager(page: Page): Promise<void> {
  const todos = [
    [
      "Read the CopilotKit docs",
      "Start with the quickstart and explore the core hooks.",
      "📚",
    ],
    [
      "Build a CopilotKit prototype",
      "Wire up a basic chat and register a frontend tool.",
      "🚀",
    ],
    [
      "Explore shared agent state",
      "Watch the canvas re-render as the agent writes to state.",
      "🎯",
    ],
  ] as const;
  for (const [title, description, emoji] of todos) {
    const card = `section[aria-label="To Do column"] div.group:has(> button[aria-label="Delete todo"]):has(div:text-is(${JSON.stringify(title)}))`;
    await assertVisibleValues(page, card, [title, description, emoji]);
    await page.waitForSelector(
      `${card} [role="checkbox"][aria-checked="false"]`,
      { state: "visible", timeout: SIBLING_TIMEOUT_MS },
    );
  }
}

/** All five existing registry keys certify the same complete public route. */
export function buildBeautifulRouteTurns(): ConversationTurn[] {
  return BEAUTIFUL_ROUTE_ACTIONS.map((action) => {
    let initiallyDark = false;
    return {
      // Beautiful-chat tool renderers require independent initial-page scenarios;
      // the historical per-pill probes already isolated every renderer this way.
      scenario: "fresh" as const,
      input: action.expectedDispatchedPrompt,
      action,
      ...(action.id === "beautiful-toggle-theme"
        ? { completeOnMount: { testIds: ["copilot-assistant-message"] } }
        : {}),
      preFill: async (page: Page) => {
        await assertBeautifulInventory(page);
        initiallyDark = await readIsHtmlDark(page);
      },
      assertions: async (page: Page) => {
        switch (action.id) {
          case "beautiful-pie-chart":
            return assertPieChart(page);
          case "beautiful-bar-chart":
            return assertBarChart(page);
          case "beautiful-schedule-meeting":
            return assertScheduleMeeting(page);
          case "beautiful-search-flights":
            return assertSearchFlights(page);
          case "beautiful-toggle-theme":
            return assertToggleTheme(page, initiallyDark);
          case "beautiful-sales-dashboard":
            return assertSalesDashboard(page);
          case "beautiful-task-manager":
            return assertTaskManager(page);
          default:
            // These actual controls remain REQUIRED. A mount or narration is
            // insufficient evidence of their full semantic output; fail closed
            // until the real output contract is empirically established.
            throw new UnverifiedDefinitionError(
              `${action.id}: canonical semantic output contract is unresolved; this required action cannot certify the beautiful-chat route`,
            );
        }
      },
    };
  });
}
