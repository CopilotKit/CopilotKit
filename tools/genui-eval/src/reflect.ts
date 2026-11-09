import {
  renderGenerativeUIComponentList,
  renderGenerativeUISchema,
  schemaCoverage,
} from "@copilotkit/shared";
import type { GenerativeUIPromptSpec } from "@copilotkit/shared";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { Transport } from "./config";
import { catalogFor, renderedPrompts } from "./harness";
import type { SampleRecord } from "./results";
import { completeSpec } from "./spec";

/** How much longer than the baseline a candidate's prompt may be, per transport. */
export const MAX_TOKEN_GROWTH = 0.1;

/** What the reflection model may and may not change. Shown to it verbatim. */
export const REFLECTION_RULES = `You improve the system prompt that teaches language models to write A2UI 1.0 user interfaces inside a chat.
The prompt is given as a JSON "prompt spec". You return a complete, improved spec.

You may change:
- the wording, order and structure of "intro", "whenToShow", "operations" and "rules", for both transports ("markdown" writes A2UI in \`\`\`a2ui fences, "tool" calls render_ui);
- the items of the conditional blocks ({"when":[...],"items":[...]}): rewrite, reorder, add or remove items, and move a block, but keep each "when" list exactly as it is, because it decides for which catalogs the block is sent;
- "schema": how the component schema is written ("notation": "compact" | "json-schema" | "ts-signature" | "lines", "propDescriptions", "commonProps");
- "descriptions": replacement descriptions for components ("Name") and props ("Name.prop") of the catalog listed below.

You must not:
- change the A2UI protocol: operation names, field names, the JSON shapes, bindings ({"@path":...}, {"@call":...}) and the fence or tool format stay exactly as the examples show;
- describe a component or prop as doing something it does not do;
- make the prompt longer than the token limit given below. Shorter is better when it works as well.

Fix the failures below by changing the prompt so that models avoid them, for every model, not just one.
Return the complete spec as JSON in one \`\`\`json fence and nothing else.`;

/** One failure as the reflection model sees it. */
function describeFailure(sample: SampleRecord, message: string | undefined) {
  const failed = Object.entries(sample.tiers)
    .filter(([, t]) => t.pass === false)
    .map(([tier, t]) => `${tier}: ${t.reasons.slice(0, 3).join("; ")}`)
    .join(" | ");
  const reply = (
    sample.output.text || JSON.stringify(sample.output.toolCalls)
  ).slice(0, 1500);
  return `- case ${sample.case} (${sample.model}, ${sample.transport}): ${message ?? ""}\n  failed: ${failed}\n  reply: ${reply.replace(/\n/g, "\n    ")}`;
}

/** The catalog's components and their props, so description keys are real. */
function catalogKeys(spec: GenerativeUIPromptSpec) {
  const { manifest } = catalogFor(spec);
  return Object.entries(manifest.components)
    .map(([name, c]) => {
      const props = Object.keys(
        (c.props.properties as Record<string, unknown> | undefined) ?? {},
      );
      return `${name}(${props.join(", ")})`;
    })
    .join("; ");
}

/** The reflection prompt for a parent spec and its failures. */
export function reflectionPrompt(
  spec: GenerativeUIPromptSpec,
  failures: Array<{ sample: SampleRecord; message?: string }>,
  tokenLimits: Partial<Record<Transport, number>>,
) {
  return [
    REFLECTION_RULES,
    `Token limits of the rendered guide: ${Object.entries(tokenLimits)
      .map(([t, n]) => `${t} ${n}`)
      .join(", ")}.`,
    `Catalog components and props: ${catalogKeys(spec)}`,
    `Failures of the current prompt:\n${failures.map((f) => describeFailure(f.sample, f.message)).join("\n")}`,
    `Current spec:\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\``,
  ].join("\n\n");
}

/**
 * The output cap of a reflection: room for a whole spec half again as long
 * as the parent, plus some reasoning. A reply cut at the cap is not valid
 * JSON and is discarded, so the cap also bounds the cost.
 */
export function reflectionOutputCap(parent: GenerativeUIPromptSpec) {
  return Math.ceil((JSON.stringify(parent).length / 4) * 1.5) + 2000;
}

/** Why a candidate spec cannot be scored. */
export interface CandidateProblem {
  kind: "invalid" | "coverage" | "tokens" | "when";
  message: string;
}

/** The `when` lists of a section's blocks, in order. */
const whenLists = (items: GenerativeUIPromptSpec["markdown"]["rules"]) =>
  items
    .filter((item) => typeof item !== "string")
    .map((item) => (item as { when: string[] }).when.join("+"))
    .sort();

/**
 * Checks a candidate against the search space: every block keeps its
 * conditions, the schema covers every component and prop in both
 * transports, and the rendered guide stays within the token limits.
 * Unknown description keys are dropped, not fatal.
 */
export function checkCandidate(
  candidate: GenerativeUIPromptSpec,
  parent: GenerativeUIPromptSpec,
  tokenLimits: Partial<Record<Transport, number>>,
): { spec: GenerativeUIPromptSpec; problems: CandidateProblem[] } {
  const problems: CandidateProblem[] = [];
  const { manifest, unknownDescriptions } = catalogFor(candidate);
  const spec = {
    ...candidate,
    descriptions: Object.fromEntries(
      Object.entries(candidate.descriptions).filter(
        ([key]) => !unknownDescriptions.includes(key),
      ),
    ),
  };
  for (const transport of ["markdown", "tool"] as const) {
    for (const part of ["rules", "operations"] as const) {
      const mine = whenLists(spec[transport][part] ?? []);
      const theirs = whenLists(parent[transport][part] ?? []);
      if (mine.join(",") !== theirs.join(",")) {
        problems.push({
          kind: "when",
          message: `${transport}.${part}: the conditional blocks changed (${theirs.join(",")} -> ${mine.join(",")})`,
        });
      }
    }
  }
  const markdownSchema = renderGenerativeUISchema(
    manifest,
    spec.schema.markdown,
  );
  const toolList = renderGenerativeUIComponentList(
    manifest.components,
    spec.schema.tool,
  );
  for (const [transport, text] of [
    ["markdown", markdownSchema],
    ["tool", toolList],
  ] as const) {
    const { missing } = schemaCoverage(manifest, text);
    if (missing.length > 0) {
      problems.push({
        kind: "coverage",
        message: `${transport} schema leaves out ${missing.slice(0, 5).join(", ")}`,
      });
    }
  }
  const prompts = renderedPrompts(spec);
  for (const [transport, limit] of Object.entries(tokenLimits) as Array<
    [Transport, number]
  >) {
    const tokens = Math.ceil(prompts[transport].length / 4);
    if (tokens > limit) {
      problems.push({
        kind: "tokens",
        message: `${transport} guide is ${tokens} tokens, over the limit of ${limit}`,
      });
    }
  }
  return { spec, problems };
}

/**
 * Asks the reflection model for an improved spec. Returns the candidate and
 * any problems; a reply that is not a valid spec comes back as an
 * `invalid` problem.
 */
export async function reflect(
  model: LanguageModel,
  parent: GenerativeUIPromptSpec,
  failures: Array<{ sample: SampleRecord; message?: string }>,
  tokenLimits: Partial<Record<Transport, number>>,
  maxOutputTokens = reflectionOutputCap(parent),
): Promise<{
  spec?: GenerativeUIPromptSpec;
  problems: CandidateProblem[];
  tokens: { input: number; output: number };
}> {
  const result = await generateText({
    model,
    prompt: reflectionPrompt(parent, failures, tokenLimits),
    temperature: 0.7,
    maxOutputTokens,
  });
  const tokens = {
    input: result.usage.inputTokens ?? 0,
    output: result.usage.outputTokens ?? 0,
  };
  const body = /```json\n([\s\S]*?)\n```/.exec(result.text)?.[1] ?? result.text;
  let candidate: GenerativeUIPromptSpec;
  try {
    candidate = completeSpec(JSON.parse(body));
  } catch (error) {
    return {
      problems: [
        { kind: "invalid", message: (error as Error).message.slice(0, 300) },
      ],
      tokens,
    };
  }
  const checked = checkCandidate(candidate, parent, tokenLimits);
  return { ...checked, tokens };
}
