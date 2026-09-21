/** Canonical LGP authored controls. All frontends use these exact contracts. */
import type { Page as PlaywrightPage } from "playwright";
import { UnverifiedDefinitionError } from "../helpers/conversation-runner.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  assertCanonicalPillInventory,
  assertRechartsValues,
} from "./_gen-ui-shared.js";

export const RENDERING_PILLS = {
  "a2ui-recovery": [
    {
      id: "a2ui-recovery-1",
      buttonName: "Recover a bad render",
      expectedDispatchedPrompt:
        "Build my Q2 revenue summary and self-correct a malformed first attempt.",
    },
    {
      id: "a2ui-recovery-2",
      buttonName: "Show an unrecoverable failure",
      expectedDispatchedPrompt:
        "Build a report that fails every validation pass so I can preview the fallback.",
    },
  ],
  "a2ui-fixed-schema": [
    {
      id: "a2ui-fixed-schema-1",
      buttonName: "Find SFO → JFK",
      expectedDispatchedPrompt:
        "Find me a flight from SFO to JFK on United for $289.",
    },
  ],
  "gen-ui-agent": [
    {
      id: "gen-ui-agent-1",
      buttonName: "Plan a product launch",
      expectedDispatchedPrompt: "Plan a product launch for a new mobile app.",
    },
    {
      id: "gen-ui-agent-2",
      buttonName: "Organize a team offsite",
      expectedDispatchedPrompt:
        "Organize a three-day engineering team offsite.",
    },
    {
      id: "gen-ui-agent-3",
      buttonName: "Research a competitor",
      expectedDispatchedPrompt:
        "Research our top competitor and summarize their strengths and weaknesses.",
    },
  ],
  "gen-ui-tool-based": [
    {
      id: "gen-ui-tool-based-1",
      buttonName: "Sales bar chart",
      expectedDispatchedPrompt:
        "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.",
    },
    {
      id: "gen-ui-tool-based-2",
      buttonName: "Traffic pie chart",
      expectedDispatchedPrompt:
        "Show me a pie chart of website traffic by source.",
    },
    {
      id: "gen-ui-tool-based-3",
      buttonName: "Market share",
      expectedDispatchedPrompt:
        "Show a pie chart of smartphone market share by brand.",
    },
  ],
  "open-gen-ui": [
    {
      id: "open-gen-ui-1",
      buttonName: "3D axis visualization",
      expectedDispatchedPrompt: "3D axis visualization (model airplane)",
    },
    {
      id: "open-gen-ui-2",
      buttonName: "How a neural network works",
      expectedDispatchedPrompt: "How a neural network works",
    },
    {
      id: "open-gen-ui-3",
      buttonName: "Quicksort visualization",
      expectedDispatchedPrompt: "Quicksort visualization",
    },
    {
      id: "open-gen-ui-4",
      buttonName: "Fourier: square wave from sines",
      expectedDispatchedPrompt: "Fourier: square wave from sines",
    },
  ],
  "open-gen-ui-advanced": [
    {
      id: "open-gen-ui-advanced-1",
      buttonName: "Calculator",
      expectedDispatchedPrompt: "Calculator (calls evaluateExpression)",
    },
    {
      id: "open-gen-ui-advanced-2",
      buttonName: "Ping the host",
      expectedDispatchedPrompt: "Ping the host (calls notifyHost)",
    },
    {
      id: "open-gen-ui-advanced-3",
      buttonName: "Inline expression evaluator",
      expectedDispatchedPrompt: "Inline expression evaluator",
    },
  ],
  "declarative-hashbrown": [
    {
      id: "declarative-hashbrown-1",
      buttonName: "Sales dashboard",
      expectedDispatchedPrompt:
        "Show me a Q4 sales dashboard. Include a total-revenue metric card, a pie chart of revenue by segment, and a bar chart of monthly revenue.",
    },
    {
      id: "declarative-hashbrown-2",
      buttonName: "Revenue by category",
      expectedDispatchedPrompt:
        "Break down Q4 revenue by product category as a pie chart. Include at least four segments with realistic sample values.",
    },
    {
      id: "declarative-hashbrown-3",
      buttonName: "Expense trend",
      expectedDispatchedPrompt:
        "Show me monthly operating expenses for the last six months as a bar chart with one bar per month.",
    },
  ],
  "declarative-json-render": [
    {
      id: "declarative-json-render-1",
      buttonName: "Sales dashboard",
      expectedDispatchedPrompt:
        "Show me the sales dashboard with metrics and a revenue chart",
    },
    {
      id: "declarative-json-render-2",
      buttonName: "Revenue by category",
      expectedDispatchedPrompt: "Break down revenue by category as a pie chart",
    },
    {
      id: "declarative-json-render-3",
      buttonName: "Expense trend",
      expectedDispatchedPrompt: "Show me monthly expenses as a bar chart",
    },
  ],
} as const;
export type RenderingRoute = keyof typeof RENDERING_PILLS;

function browserRead<T>(page: Page, body: string): Promise<T> {
  // Browser closures cannot capture host variables; all inserted values are JSON encoded.
  return page.evaluate(new Function(body) as () => T);
}
const visible =
  "e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'";

async function visibleLeafRows(
  page: Page,
  selector: string,
  baseline = 0,
): Promise<string[][]> {
  return browserRead(
    page,
    `return Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(${baseline}).filter(${visible}).map(row => Array.from(row.querySelectorAll('*')).filter(${visible}).filter(e=>e.children.length===0).map(e=>e.textContent).filter(Boolean));`,
  );
}
function requireRows(
  observed: readonly (readonly string[])[],
  expected: readonly (readonly string[])[],
  tag: string,
): void {
  if (
    observed.length !== expected.length ||
    expected.some((row, index) =>
      row.some((value, position) => {
        const actual = observed[index] ?? [];
        const at = actual.indexOf(value);
        return (
          at < 0 || (position > 0 && at <= actual.indexOf(row[position - 1]!))
        );
      }),
    )
  ) {
    throw new Error(
      `${tag}: canonical visible row/value associations differ; observed ${JSON.stringify(observed)}`,
    );
  }
}
async function count(page: Page, selector: string): Promise<number> {
  return browserRead(
    page,
    `return document.querySelectorAll(${JSON.stringify(selector)}).length;`,
  );
}

export interface PieSliceGeometry {
  arc: number;
  gap: number;
  radius: number;
  offset: number;
  visible: boolean;
}

/** Validate the actual donut marks against the values printed in its legend. */
export function assertCanonicalPieGeometry(
  slices: readonly PieSliceGeometry[],
  expected: readonly number[],
): void {
  const total = expected.reduce((sum, value) => sum + value, 0);
  if (
    !expected.length ||
    !Number.isFinite(total) ||
    total <= 0 ||
    slices.length !== expected.length
  ) {
    throw new Error("canonical pie geometry: missing or extra slice marks");
  }
  let priorValue = 0;
  for (const [index, slice] of slices.entries()) {
    if (
      !slice.visible ||
      ![slice.arc, slice.gap, slice.radius, slice.offset].every(
        Number.isFinite,
      ) ||
      slice.radius <= 0
    ) {
      throw new Error("canonical pie geometry: unpainted or non-finite slice");
    }
    const circumference = 2 * Math.PI * slice.radius;
    const arc = (expected[index]! / total) * circumference;
    const offset = (-priorValue / total) * circumference;
    if (
      Math.abs(slice.arc - arc) > 0.001 ||
      Math.abs(slice.gap - (circumference - arc)) > 0.001 ||
      Math.abs(slice.offset - offset) > 0.001
    ) {
      throw new Error(
        "canonical pie geometry: slice proportions or offsets differ",
      );
    }
    priorValue += expected[index]!;
  }
}

// Used inside the browser, after selecting the actual rendered chart element.
const readPieGeometry = `Array.from(chart.querySelectorAll('svg circle[stroke-dasharray]')).map(e=>{
  const numeric = value => value === null || value.trim() === '' ? NaN : Number(value);
  const dash = (e.getAttribute('stroke-dasharray') ?? '').trim().split(/[ ,]+/);
  const style = getComputedStyle(e);
  return {arc:dash.length===2 ? numeric(dash[0]) : NaN,gap:dash.length===2 ? numeric(dash[1]) : NaN,radius:numeric(e.getAttribute('r')),offset:numeric(e.getAttribute('stroke-dashoffset')),visible:e.getClientRects().length>0 && style.visibility!=='hidden' && style.display!=='none' && style.stroke!=='none' && Number(style.strokeOpacity)>0 && Number(style.opacity)>0 && parseFloat(style.strokeWidth)>0};
})`;

const agentRows = [
  [
    "Define launch goals and audience",
    "Coordinate marketing and PR rollout",
    "Track post-launch metrics for week 1",
  ],
  [
    "Reserve venue near downtown for 30 engineers",
    "Build day-by-day agenda with workshop slots",
    "Arrange travel, lodging and group meals",
  ],
  [
    "Map competitor product surface and pricing tiers",
    "Summarize their public differentiation themes",
    "Identify weaknesses our positioning can exploit",
  ],
] as const;

export function buildRenderingTurns(route: RenderingRoute): ConversationTurn[] {
  const pills = RENDERING_PILLS[route];
  return pills.map((pill, index) => {
    let baseline = 0;
    let failureBaseline = 0;
    let chartBaseline = 0;
    const selector =
      route === "a2ui-fixed-schema"
        ? '[data-testid="a2ui-fixed-card"]'
        : route === "a2ui-recovery"
          ? '[data-testid="declarative-metric"]'
          : route === "gen-ui-agent"
            ? '[data-testid="agent-step"]'
            : route.startsWith("open-gen-ui")
              ? 'iframe[sandbox*="allow-scripts"]'
              : route === "gen-ui-tool-based"
                ? '[data-testid="copilot-assistant-message"]'
                : '[data-testid="metric-card"]';
    return {
      input: pill.expectedDispatchedPrompt,
      action: { ...pill, kind: "pill", submission: { kind: "immediate" } },
      responseTimeoutMs: 90_000,
      preFill: async (page) => {
        await assertCanonicalPillInventory(
          page,
          pills.map((p) => p.buttonName),
        );
        baseline = await count(page, selector);
        chartBaseline = await count(page, ".recharts-wrapper");
        failureBaseline = await browserRead(
          page,
          `return Array.from(document.querySelectorAll('*')).filter(${visible}).filter(e=>e.children.length===0 && e.textContent === "Couldn't generate the UI").length;`,
        );
      },
      assertions: async (page) => {
        if (route === "a2ui-fixed-schema") {
          requireRows(
            await visibleLeafRows(page, selector, baseline),
            [["SFO", "JFK", "United", "$289"]],
            route,
          );
        } else if (route === "gen-ui-agent") {
          const rows = await browserRead<
            { text: string; status: string | null }[]
          >(
            page,
            `return Array.from(document.querySelectorAll('[data-testid="agent-step"]')).filter(${visible}).map(e=>({text:e.innerText,status:e.getAttribute('data-status')}));`,
          );
          if (
            rows.length !== agentRows[index]!.length ||
            rows.some(
              (row, i) =>
                row.status !== "completed" ||
                row.text.trim() !== agentRows[index]![i],
            )
          )
            throw new Error("gen-ui-agent: canonical completed steps differ");
          if ((await count(page, '[data-testid="agent-state-card"]')) !== 1)
            throw new Error("gen-ui-agent: expected one updating state card");
        } else if (route === "a2ui-recovery") {
          if (index === 0)
            requireRows(
              await visibleLeafRows(page, selector, baseline),
              [
                ["Quarterly Revenue", "$4.2M", "↑ +12% QoQ"],
                ["Win Rate", "31%", "↓ -2 pts"],
              ],
              route,
            );
          else {
            const failures = await browserRead<number>(
              page,
              `return Array.from(document.querySelectorAll('*')).filter(${visible}).filter(e=>e.children.length===0 && e.textContent === "Couldn't generate the UI").length;`,
            );
            if (
              failures !== failureBaseline + 1 ||
              (await count(page, selector)) !== baseline
            )
              throw new Error(
                "a2ui-recovery: expected one new failure card and no new metric surface",
              );
          }
          if (index === 0) {
            const failures = await browserRead<number>(
              page,
              `return Array.from(document.querySelectorAll('*')).filter(${visible}).filter(e=>e.children.length===0 && e.textContent === "Couldn't generate the UI").length;`,
            );
            if (failures !== failureBaseline)
              throw new Error(
                "a2ui-recovery: healed surface has unexpected failure card",
              );
          }
        } else if (route === "gen-ui-tool-based") {
          if (index === 0) {
            await assertRechartsValues(page, {
              selector: ".recharts-wrapper",
              kind: "bar",
              baseline: chartBaseline,
              expected: [
                { label: "Q1", value: 120000 },
                { label: "Q2", value: 150000 },
                { label: "Q3", value: 175000 },
                { label: "Q4", value: 210000 },
              ],
            });
          } else {
            const title =
              index === 1
                ? "Website Traffic by Source"
                : "Smartphone Market Share";
            const expected =
              index === 1
                ? [
                    ["Organic Search", "45", "45%"],
                    ["Direct", "22", "22%"],
                    ["Referral", "15", "15%"],
                    ["Social", "12", "12%"],
                    ["Paid", "6", "6%"],
                  ]
                : [
                    ["Apple", "28", "28%"],
                    ["Samsung", "22", "22%"],
                    ["Xiaomi", "14", "14%"],
                    ["Oppo", "9", "9%"],
                    ["Other", "27", "27%"],
                  ];
            const chart = await browserRead<{
              rows: string[][];
              arcs: PieSliceGeometry[];
            } | null>(
              page,
              `const title=Array.from(document.querySelectorAll('[data-testid="copilot-assistant-message"] div')).filter(${visible}).find(e=>e.children.length===0 && e.textContent===${JSON.stringify(title)}); const chart=title?.closest('.max-w-lg'); if(!chart) return null; return {rows:Array.from(chart.querySelectorAll('.space-y-2 > div')).filter(${visible}).map(row=>Array.from(row.querySelectorAll('span')).filter(${visible}).map(e=>e.textContent).filter(Boolean)), arcs:${readPieGeometry}};`,
            );
            if (!chart)
              throw new Error("gen-ui-custom: canonical pie chart missing");
            assertCanonicalPieGeometry(
              chart.arcs,
              expected.map((row) => Number(row[1])),
            );
            requireRows(chart.rows, expected, title);
          }
        } else if (route.startsWith("open-gen-ui")) {
          if (!hasFrameLocator(page))
            throw new Error(
              "open-gen-ui: real sandbox result/control surface unavailable",
            );
          const frame = page
            .frameLocator('iframe[sandbox*="allow-scripts"]')
            .nth(baseline);
          if (route === "open-gen-ui-advanced") {
            if (index === 0) {
              for (const name of ["2", "+", "3", "="])
                await frame.getByRole("button", { name, exact: true }).click();
              await requireSandboxText(frame.locator("#d"), "5");
            } else if (index === 1) {
              await frame
                .getByRole("button", {
                  name: "Say hi to the host",
                  exact: true,
                })
                .click();
              const output = frame.locator("#out");
              await output.waitFor({ state: "visible" });
              const deadline = Date.now() + 5000;
              let text = "";
              do {
                text = await output.innerText();
                if (/^host replied at .+/.test(text)) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              } while (Date.now() < deadline);
              if (!/^host replied at .+/.test(text))
                throw new Error("sandbox notifyHost reply missing");
            } else {
              await frame.locator("#in").pressSequentially("2+2");
              await frame
                .getByRole("button", { name: "Evaluate", exact: true })
                .click();
              await requireSandboxText(frame.locator("#out"), "= 4");
            }
          } else {
            const ids = [
              "ogui-3d-axis",
              "ogui-neural-net",
              "ogui-quicksort",
              "ogui-fourier",
            ];
            const svg = frame.getByTestId(ids[index]!);
            await svg.waitFor({ state: "visible" });
            if (index === 0) {
              if (
                (await svg.locator("line").count()) !== 3 ||
                JSON.stringify(await svg.locator("text").allTextContents()) !==
                  JSON.stringify(["X pitch", "Y yaw", "Z roll"])
              )
                throw new Error("3D axis: visible axis labels/lines differ");
            } else if (index === 1) {
              if ((await svg.locator("circle").count()) !== 11)
                throw new Error(
                  "neural network: expected 4 input,5 hidden,2 output nodes",
                );
              for (const [x, n] of [
                ["40", 4],
                ["160", 5],
                ["280", 2],
              ] as const)
                if ((await svg.locator(`circle[cx="${x}"]`).count()) !== n)
                  throw new Error("neural network: layer nodes differ");
            } else if (index === 2) {
              const heights = await svg
                .locator("rect")
                .evaluateAll((nodes) =>
                  nodes.map((node) => node.getAttribute("height")),
                );
              if (
                JSON.stringify(heights) !==
                JSON.stringify([
                  "40",
                  "80",
                  "110",
                  "150",
                  "130",
                  "100",
                  "160",
                  "120",
                  "70",
                  "50",
                ])
              )
                throw new Error("quicksort: canonical array bars differ");
            } else {
              // The source fixture supplies only a straight line, not a verified
              // Fourier waveform. Neither a path count nor that placeholder is an oracle.
              throw new UnverifiedDefinitionError(
                "open-gen-ui Fourier: a canonical waveform result has not been established",
              );
            }
          }
        } else if (route === "declarative-hashbrown" && index === 0) {
          requireRows(
            await visibleLeafRows(page, selector, baseline),
            [
              ["Total Revenue", "$2.4M"],
              ["New Customers", "1,847"],
              ["Conversion Rate", "3.2%"],
            ],
            route,
          );
          await assertRechartsValues(page, {
            selector: ".recharts-wrapper",
            kind: "bar",
            baseline: chartBaseline,
            expected: [
              { label: "Oct", value: 780000 },
              { label: "Nov", value: 810000 },
              { label: "Dec", value: 810000 },
            ],
          });
          const pie = await browserRead<{
            rows: string[][];
            arcs: PieSliceGeometry[];
          } | null>(
            page,
            `const chart=Array.from(document.querySelectorAll('[data-testid="pie-chart"]')).filter(${visible}).at(-1); if(!chart) return null; return {rows:Array.from(chart.querySelectorAll('.space-y-2 > div')).filter(${visible}).map(row=>Array.from(row.querySelectorAll('span')).filter(${visible}).map(e=>e.textContent).filter(Boolean)),arcs:${readPieGeometry}};`,
          );
          if (!pie) throw new Error("byoc: canonical revenue pie missing");
          assertCanonicalPieGeometry(pie.arcs, [1200000, 720000, 480000]);
          requireRows(
            pie.rows,
            [
              ["Enterprise", "1,200,000", "50%"],
              ["Mid-Market", "720,000", "30%"],
              ["SMB", "480,000", "20%"],
            ],
            route,
          );
        } else {
          throw new UnverifiedDefinitionError(
            `${route}: canonical result values have not been established for ${pill.buttonName}`,
          );
        }
      },
    } satisfies ConversationTurn;
  });
}

function hasFrameLocator(
  page: Page,
): page is Page & Pick<PlaywrightPage, "frameLocator"> {
  return "frameLocator" in page && typeof page.frameLocator === "function";
}
async function requireSandboxText(
  locator: ReturnType<PlaywrightPage["locator"]>,
  expected: string,
): Promise<void> {
  await locator.waitFor({ state: "visible" });
  let text = "";
  const deadline = Date.now() + 5000;
  do {
    text = (await locator.innerText()).trim();
    if (text === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(
    `sandbox result differs: expected ${expected}, observed ${text}`,
  );
}
