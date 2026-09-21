/** Canonical LGP controls, shared by every framework and integration. */
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  runConversation,
  UnverifiedDefinitionError,
} from "../helpers/conversation-runner.js";
import { asGenuinePage } from "./_genuine-shared.js";

export const TOOLS_AGENT_PILLS = {
  "tool-rendering": [
    {
      id: "tool-rendering-1",
      buttonName: "Weather in SF",
      prompt: "What's the weather in San Francisco?",
    },
    {
      id: "tool-rendering-2",
      buttonName: "Find flights",
      prompt: "Find flights from SFO to JFK.",
    },
    {
      id: "tool-rendering-3",
      buttonName: "Stock price",
      prompt: "What's the current price of AAPL?",
    },
    {
      id: "tool-rendering-4",
      buttonName: "Roll a d20",
      prompt: "Roll a 20-sided die.",
    },
    {
      id: "tool-rendering-5",
      buttonName: "Chain tools",
      prompt:
        "Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20.",
    },
  ],
  "tool-rendering-custom-catchall": [
    {
      id: "tool-rendering-custom-catchall-1",
      buttonName: "Weather in SF",
      prompt: "What's the weather in San Francisco?",
    },
    {
      id: "tool-rendering-custom-catchall-2",
      buttonName: "Find flights",
      prompt: "Find flights from SFO to JFK.",
    },
    {
      id: "tool-rendering-custom-catchall-3",
      buttonName: "Roll a d20",
      prompt: "Roll a 20-sided die.",
    },
    {
      id: "tool-rendering-custom-catchall-4",
      buttonName: "Chain tools",
      prompt:
        "Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20.",
    },
  ],
  "tool-rendering-default-catchall": [
    {
      id: "tool-rendering-default-catchall-1",
      buttonName: "Weather in SF",
      prompt: "What's the weather in San Francisco?",
    },
    {
      id: "tool-rendering-default-catchall-2",
      buttonName: "Find flights",
      prompt: "Find flights from SFO to JFK.",
    },
    {
      id: "tool-rendering-default-catchall-3",
      buttonName: "Roll a d20",
      prompt: "Roll a 20-sided die.",
    },
    {
      id: "tool-rendering-default-catchall-4",
      buttonName: "Chain tools",
      prompt:
        "Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20.",
    },
  ],
  "tool-rendering-reasoning-chain": [
    {
      id: "tool-rendering-reasoning-chain-1",
      buttonName: "Compare two stocks",
      prompt: "Compare AAPL and MSFT stocks for me.",
    },
    {
      id: "tool-rendering-reasoning-chain-2",
      buttonName: "Chain of dice rolls",
      prompt: "Roll a 20-sided die for me and compare it to a smaller one.",
    },
    {
      id: "tool-rendering-reasoning-chain-3",
      buttonName: "Flights + destination weather",
      prompt: "Find flights from SFO to JFK and show me the weather there.",
    },
  ],
  "reasoning-custom": [
    {
      id: "reasoning-custom-1",
      buttonName: "Show reasoning",
      prompt:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
  "reasoning-default": [
    {
      id: "reasoning-default-1",
      buttonName: "Show reasoning",
      prompt:
        "Explain step by step why the sky appears blue during the day but red at sunset.",
    },
  ],
  subagents: [
    {
      id: "subagents-1",
      buttonName: "Write a blog post",
      prompt:
        "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique.",
    },
    {
      id: "subagents-2",
      buttonName: "Explain a topic",
      prompt:
        "Explain how large language models handle tool calling. Research, write a paragraph, then critique.",
    },
    {
      id: "subagents-3",
      buttonName: "Summarize a topic",
      prompt:
        "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique.",
    },
  ],
  "mcp-apps": [
    {
      id: "mcp-apps-1",
      buttonName: "Draw a flowchart",
      prompt: "Use Excalidraw to draw a simple flowchart with three steps.",
    },
    {
      id: "mcp-apps-2",
      buttonName: "Sketch a system diagram",
      prompt:
        "Open Excalidraw and sketch a system diagram with a client, server, and database.",
    },
  ],
} as const;
export type ToolsAgentFeature = keyof typeof TOOLS_AGENT_PILLS;

const FLIGHTS = [
  ["United", "UA231", "08:15", "16:45", "348"],
  ["Delta", "DL412", "11:20", "19:55", "312"],
  ["JetBlue", "B6722", "17:05", "01:30", "289"],
];
const REASONING =
  "First, I considered that visible sunlight contains all wavelengths. Then I noted that air molecules scatter shorter wavelengths (blue) more efficiently than longer ones (Rayleigh scattering). At sunset the path through the atmosphere is much longer, so even more blue is scattered out and the remaining direct light skews red.";
const ANSWER =
  "Daytime sky looks blue because air molecules scatter short-wavelength light more strongly than long-wavelength light (Rayleigh scattering). At sunset the sun's light traverses far more atmosphere, scattering out most of the blue and leaving the remaining direct light dominated by red and orange wavelengths.";
// Expected nested outputs from the canonical LGP mcp-subagents fixture, frozen independently of candidate DOM.
const SUBAGENT_RESULTS = [
  [
    "- Brief cold immersion (cold showers, ice baths) triggers a sympathetic-nervous-system response that releases noradrenaline\n- Repeated exposure is associated with improved self-reported mood and stress tolerance\n- Activates brown adipose tissue, modestly increasing basal metabolic rate\n- May reduce post-exercise muscle soreness when used as a recovery modality\n- Health risk for people with cardiovascular conditions; sessions should be short (1-3 minutes) and supervised at first",
    "Cold exposure training \u2014 short, deliberate plunges into cold water or showers \u2014 has earned a foothold in modern recovery routines for reasons grounded in physiology rather than folklore. Each immersion produces a measurable surge of noradrenaline, the same chemistry that underpins the lift practitioners report in mood and focus afterward; with repetition, that response is associated with greater day-to-day stress tolerance. Cold also activates brown adipose tissue and can blunt post-exercise soreness, making it a low-cost adjunct for active people. The honest caveat is cardiovascular risk: keep early sessions to one to three minutes, and if you have a heart condition, get a green light before you start.",
    "1. The phrase 'measurable surge of noradrenaline' should cite a study or rough magnitude \u2014 without a number, the claim reads as marketing rather than evidence.\n2. 'Modern recovery routines' is filler; lead with the physiological mechanism instead and let the cultural framing follow.\n3. The cardiovascular caveat is buried at the end. Move it earlier or make it a standalone closing line so a reader who skims still sees it.",
  ],
  [
    "- The model is shown a tool schema (name, description, JSON-schema parameters) inside the system or developer prompt at request time\n- During decoding, instead of emitting natural-language text, the model emits a structured tool_call block (function name + JSON-encoded arguments)\n- The application runs the tool, packages the result into a tool message, and resends the full conversation so the model can continue\n- Modern decoders use constrained decoding or grammars to keep the arguments syntactically valid JSON\n- The model decides on tool use turn-by-turn \u2014 there is no out-of-band channel; tool calls are just a different message role in the same chat thread",
    "Large language models handle tool calling by treating tools as a structured extension of the chat protocol rather than a separate channel. At request time the application supplies each tool's name, description, and JSON-schema parameters in the prompt; during decoding the model can emit a tool_call block \u2014 a function name plus JSON-encoded arguments \u2014 instead of plain text, with constrained decoding keeping the arguments syntactically valid. The application then executes the tool and replays the result back as a tool-role message, and the model continues the conversation from there. The decision to call a tool is made turn-by-turn, so a single user request can fan out into a chain of tool calls that the model orchestrates as it reads each result.",
    "1. The opening contrast 'rather than a separate channel' assumes the reader already knows what a 'separate channel' would mean \u2014 either drop the contrast or give a one-clause example (e.g., 'rather than a side API the model talks to in parallel').\n2. 'Constrained decoding keeping the arguments syntactically valid' is technically correct but vague; mention that this is what makes the JSON parseable on the application side.\n3. The final sentence introduces multi-tool chains without saying who controls the loop \u2014 clarify that the application is the runtime that decides whether to keep going, not the model itself.",
  ],
  [
    "- SpaceX Falcon 9 routinely lands and re-flies first stages; individual boosters have flown more than 20 missions each\n- Falcon Heavy reuses both side boosters; the center core has been recovered on a subset of flights\n- Rocket Lab's Electron has demonstrated mid-air booster catch but routine reuse is still in development\n- SpaceX Starship is targeting full reuse of both stages; orbital test flights are ongoing as of 2024-2025\n- Reuse is the dominant lever on launch cost: Falcon 9 list pricing is set well below expendable competitors largely because of stage recovery",
    "Reusable rockets have shifted from a research goal to the default cost lever in commercial spaceflight. SpaceX's Falcon 9 routinely lands and re-flies its first stage \u2014 individual boosters have now flown twenty-plus missions \u2014 and Falcon Heavy reuses both side boosters with intermittent recovery of the center core. Smaller-class operators like Rocket Lab have demonstrated mid-air booster catch but have not yet made reuse routine, while SpaceX's Starship is in active flight testing toward full two-stage reuse. The economic consequence is already visible: Falcon 9 list pricing sits well below expendable competitors precisely because the dominant cost \u2014 building a fresh first stage every flight \u2014 has been amortized across many missions.",
    "1. 'Default cost lever' is jargon that pre-supposes the reader already accepts the framing \u2014 open instead with the concrete result (Falcon 9 reflight count) and let the framing emerge.\n2. The Starship sentence is hedged ('in active flight testing toward full reuse') in a way that obscures the actual milestone reached as of writing \u2014 name the latest test outcome or drop the clause.\n3. The closing economic claim asserts pricing is 'well below expendable competitors' without a reference price; one number (e.g., $/kg-to-LEO) would land the point much harder than the qualitative claim alone.",
  ],
] as const;
const SELECTORS = {
  weather: '[data-testid="weather-card"]',
  flights: '[data-testid="flights-card"], [data-testid="flight-list-card"]',
  stock: '[data-testid="stock-card"]',
  dice: '[data-testid="d20-card"]',
  custom: '[data-testid="custom-wildcard-card"]',
  default: '[data-testid="copilot-tool-render"]',
  chain: '[data-testid="custom-catchall-card"]',
  reasoning:
    '[data-testid="reasoning-block"], [data-message-id]:has(> button[aria-expanded])',
  researcher: '[data-testid="subagent-card-researcher"]',
  writer: '[data-testid="subagent-card-writer"]',
  critic: '[data-testid="subagent-card-critic"]',
  iframe: "iframe[sandbox]",
};
type Surface = keyof typeof SELECTORS;
type Card = {
  text: string;
  visible: boolean;
  status: string | null;
  tool: string | null;
  fields: Record<string, string[]>;
  pre: string[];
};
type Snapshot = Record<Surface, Card[]>;
const FIELD_IDS = [
  "weather-city",
  "weather-humidity",
  "weather-wind",
  "flight-origin",
  "flight-destination",
  "flight-row",
  "stock-ticker",
  "stock-price",
  "stock-change",
  "d20-value",
  "subagent-result",
];

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(
    new Function(`
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const selectors = ${JSON.stringify(SELECTORS)};
    const fields = ${JSON.stringify(FIELD_IDS)};
    return Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key,
      Array.from(document.querySelectorAll(selector)).map(e => ({
        text: e.innerText ?? '', visible: visible(e), status:e.getAttribute('data-status'), tool:e.getAttribute('data-tool-name'),
        fields:Object.fromEntries(fields.map(id => [id,Array.from(e.querySelectorAll('[data-testid="'+id+'"]')).filter(visible).map(x=>x.innerText)])),
        pre:Array.from(e.querySelectorAll('pre')).filter(visible).map(x=>x.innerText)
      }))]));
  `) as () => Snapshot,
  );
}
function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, comparable(item)]),
    );
  return value;
}
function exact(actual: unknown, expected: unknown, label: string): void {
  requireValue(
    JSON.stringify(comparable(actual)) === JSON.stringify(comparable(expected)),
    `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
  );
}
function hasTokens(
  text: string,
  tokens: readonly string[],
  label: string,
): void {
  for (const token of tokens)
    requireValue(
      text.includes(token),
      `${label}: missing canonical value ${JSON.stringify(token)}`,
    );
}
function fresh(
  snap: Snapshot,
  baseline: Snapshot,
  key: Surface,
  count: number,
): Card[] {
  const cards = snap[key].slice(baseline[key].length);
  exact(cards.length, count, `${key} new card count`);
  requireValue(
    cards.every((c) => c.visible),
    `${key}: hidden result cannot pass`,
  );
  return cards;
}
function weather(card: Card, city: string): void {
  exact(card.fields["weather-city"], [city], "weather city");
  requireValue(
    /(?:^|[^0-9.+-])68°\s*F(?:$|[^A-Za-z])/.test(card.text) &&
      card.text.split("\n").some((line) => line.trim() === "Sunny"),
    "weather temperature/condition differs",
  );
  requireValue(
    /(?:^|[^0-9.+-])55%(?:$|[^0-9])/.test(
      card.fields["weather-humidity"]?.[0] ?? "",
    ),
    "humidity differs",
  );
  requireValue(
    /(?:^|[^0-9.+-])10\s+mph\b/.test(card.fields["weather-wind"]?.[0] ?? ""),
    "wind differs",
  );
}
function flights(card: Card, destination: string): void {
  exact(card.fields["flight-origin"], ["SFO"], "flight origin");
  exact(card.fields["flight-destination"], [destination], "flight destination");
  exact(card.fields["flight-row"]?.length, 3, "flight row count");
  FLIGHTS.forEach(([airline, flight, depart, arrive, price], i) =>
    exact(
      (card.fields["flight-row"]?.[i] ?? "").replace(/\s+/g, " ").trim(),
      `${airline} ${flight} ${depart} → ${arrive} $${price}`,
      `flight ${i + 1}`,
    ),
  );
}
function objectResult(card: Card): Record<string, unknown> {
  requireValue(card.status === "complete", `${card.tool}: result not complete`);
  requireValue(
    card.pre.length === 2,
    `${card.tool}: visible arguments and result required`,
  );
  let result: unknown = JSON.parse(card.pre[1]!);
  if (typeof result === "string") result = JSON.parse(result);
  requireValue(
    typeof result === "object" && result !== null && !Array.isArray(result),
    "tool result must be a JSON object",
  );
  return result as Record<string, unknown>;
}
function checkToolJson(
  card: Card,
  tool: string,
  kind: string,
  city = "San Francisco",
): void {
  exact(card.tool, tool, "tool name");
  const value = objectResult(card);
  if (kind === "weather") {
    for (const [key, expected] of Object.entries({
      city,
      temperature: 68,
      humidity: 55,
      wind_speed: 10,
      conditions: "Sunny",
    }))
      exact(value[key], expected, `weather ${key}`);
  } else if (kind === "flights") {
    exact(value.origin, "SFO", "flight origin");
    exact(value.destination, city, "flight destination");
    exact(
      value.flights,
      FLIGHTS.map(([airline, flight, depart, arrive, price]) => ({
        airline,
        flight,
        depart,
        arrive,
        price_usd: Number(price),
      })),
      "flight results",
    );
  }
}

/** Every turn has one real pill, exact dispatch and a fresh-result assertion. */
export function buildToolsAgentTurns(
  feature: ToolsAgentFeature,
): ConversationTurn[] {
  const pills = TOOLS_AGENT_PILLS[feature];
  return pills.map((pill, index) => {
    let baseline: Snapshot;
    return {
      input: pill.prompt,
      action: {
        kind: "pill",
        id: pill.id,
        buttonName: pill.buttonName,
        expectedDispatchedPrompt: pill.prompt,
        submission: { kind: "immediate" },
      },
      responseTimeoutMs: 90_000,
      preFill: async (page) => {
        await page.waitForSelector('[data-testid="copilot-suggestion"]', {
          state: "visible",
          timeout: 15_000,
        });
        const names = await page.evaluate(
          new Function(
            `return Array.from(document.querySelectorAll('[data-testid="copilot-suggestion"]')).map(e=>e.innerText);`,
          ) as () => string[],
        );
        exact(
          names,
          pills.map((p) => p.buttonName),
          `${feature} canonical pill inventory`,
        );
        baseline = await snapshot(page);
      },
      assertions: async (page, ctx) => {
        // Expand actual visible details through real pointer clicks before inspecting values.
        if (feature === "tool-rendering-default-catchall") {
          const counts = await snapshot(page);
          for (
            let i = baseline.default.length;
            i < counts.default.length;
            i++
          ) {
            await asGenuinePage(page, feature).click(
              `:nth-match([data-testid="copilot-tool-render"], ${i + 1}) button[aria-expanded="false"]`,
              { timeout: 5_000 },
            );
          }
        }
        if (feature === "reasoning-default") {
          await asGenuinePage(page, feature).click(
            '[data-message-id] > button[aria-expanded="false"]',
            { timeout: 5_000 },
          );
        }
        const snap = await snapshot(page);
        if (feature === "reasoning-custom" || feature === "reasoning-default") {
          const cards = fresh(snap, baseline, "reasoning", 1);
          hasTokens(cards[0]!.text, [REASONING], "reasoning content");
          exact(ctx.text.trim(), ANSWER, "reasoning answer");
          return;
        }
        if (feature === "mcp-apps") {
          fresh(snap, baseline, "iframe", 1);
          // Mounting an empty iframe is insufficient to prove the drawing.
          throw new UnverifiedDefinitionError(
            "mcp-apps: canonical drawing content is not observable through the sandboxed frame; no functional certification",
          );
        }
        if (feature === "subagents") {
          const tokens = [
            ["noradrenaline", "cardiovascular"],
            ["tool_call", "JSON"],
            ["Falcon 9", "Starship"],
          ][index]!;
          for (const [roleIndex, role] of (
            ["researcher", "writer", "critic"] as const
          ).entries()) {
            const card = fresh(snap, baseline, role, 1)[0]!;
            exact(card.status, "complete", `${role} status`);
            const result = card.fields["subagent-result"]?.[0] ?? "";
            requireValue(
              result.length > 0 &&
                !result.includes("(empty)") &&
                !result.includes("<sub-agent produced no output>"),
              `${role}: missing result`,
            );
            exact(
              result.trim(),
              SUBAGENT_RESULTS[index]![roleIndex],
              `${role} canonical result`,
            );
          }
          hasTokens(ctx.text, tokens, "subagent final answer");
          return;
        }
        if (feature === "tool-rendering-reasoning-chain") {
          requireValue(
            snap.reasoning.length > baseline.reasoning.length,
            "reasoning chain requires new reasoning content",
          );
          requireValue(
            snap.reasoning
              .slice(baseline.reasoning.length)
              .every((c) => c.visible && c.text.length > 40),
            "reasoning chain content missing",
          );
          if (index === 0) {
            const cards = fresh(snap, baseline, "chain", 2);
            const values = cards.map((c) => {
              exact(c.tool, "get_stock_price", "stock tool");
              return objectResult(c);
            });
            exact(
              values,
              [
                { ticker: "AAPL", price_usd: 338.37, change_pct: -2.96 },
                { ticker: "MSFT", price_usd: 412.18, change_pct: 1.08 },
              ],
              "stock comparison",
            );
          } else if (index === 1) {
            const cards = fresh(snap, baseline, "chain", 2);
            cards.forEach((card, i) => {
              exact(card.tool, "roll_dice", "dice tool");
              const value = objectResult(card),
                sides = i === 0 ? 20 : 6;
              exact(value.sides, sides, "dice sides");
              requireValue(
                typeof value.result === "number" &&
                  Number.isInteger(value.result) &&
                  value.result >= 1 &&
                  value.result <= sides,
                "dice result out of canonical range",
              );
              const args = JSON.parse(card.pre[0]!);
              exact(args.sides, sides, "dice arguments");
            });
          } else {
            flights(fresh(snap, baseline, "flights", 1)[0]!, "JFK");
            weather(fresh(snap, baseline, "weather", 1)[0]!, "JFK");
          }
          return;
        }
        const kind = pill.buttonName;
        if (feature === "tool-rendering") {
          if (kind === "Weather in SF")
            weather(fresh(snap, baseline, "weather", 1)[0]!, "San Francisco");
          else if (kind === "Find flights")
            flights(fresh(snap, baseline, "flights", 1)[0]!, "JFK");
          else if (kind === "Stock price") {
            const card = fresh(snap, baseline, "stock", 1)[0]!;
            exact(card.fields["stock-ticker"], ["AAPL"], "ticker");
            exact(card.fields["stock-price"], ["$338.37"], "stock price");
            exact(card.fields["stock-change"], ["-2.96%"], "stock change");
          } else if (kind === "Roll a d20")
            exact(
              fresh(snap, baseline, "dice", 5).map(
                (c) => c.fields["d20-value"]?.[0],
              ),
              ["7", "14", "3", "19", "20"],
              "dice sequence",
            );
          else {
            weather(fresh(snap, baseline, "weather", 1)[0]!, "Tokyo");
            flights(fresh(snap, baseline, "flights", 1)[0]!, "Tokyo");
            exact(
              fresh(snap, baseline, "dice", 1)[0]!.fields["d20-value"],
              ["11"],
              "chain dice",
            );
          }
        } else {
          const surface =
            feature === "tool-rendering-custom-catchall" ? "custom" : "default";
          const cards = fresh(
            snap,
            baseline,
            surface,
            kind === "Roll a d20" ? 5 : kind === "Chain tools" ? 3 : 1,
          );
          if (kind === "Weather in SF")
            checkToolJson(cards[0]!, "get_weather", "weather");
          else if (kind === "Find flights")
            checkToolJson(cards[0]!, "search_flights", "flights", "JFK");
          else if (kind === "Roll a d20")
            cards.forEach((c, i) => {
              exact(c.tool, "roll_d20", "dice tool");
              const value = objectResult(c);
              exact(value.sides, 20, "dice sides");
              exact(value.value, [7, 14, 3, 19, 20][i], "dice result");
            });
          else {
            checkToolJson(cards[0]!, "get_weather", "weather", "Tokyo");
            checkToolJson(cards[1]!, "search_flights", "flights", "Tokyo");
            exact(cards[2]!.tool, "roll_d20", "chain dice tool");
            const value = objectResult(cards[2]!);
            exact(value.sides, 20, "chain sides");
            exact(value.value, 11, "chain dice");
          }
        }
      },
    };
  });
}

export function noLgpCanonicalTurns(feature: string): never {
  throw new UnverifiedDefinitionError(
    `${feature}: no canonical LGP demo/pill contract; functional acceptance unavailable`,
  );
}

/** Local specs are evidence only. Public matrix admission uses the runner signal. */
export async function runToolsAgentLocalContract(
  page: Page,
  feature: ToolsAgentFeature,
  integration: string,
  url: string,
) {
  return runConversation(page, buildToolsAgentTurns(feature), {
    mode: "functional-pill",
    surface: "direct-diagnostic",
    identity: { frontend: "react", integration, canonical: feature, url },
  });
}
