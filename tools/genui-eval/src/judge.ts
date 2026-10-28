import { readFileSync } from "node:fs";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { caseContext } from "./cases";
import type { EvalCase } from "./cases";
import { MAX_JUDGE_TOKENS } from "./cost";
import type { SampleOutput } from "./harness";

/** A judge score from 0 to 1 and its one-line reason. `null` when the judge failed. */
export interface JudgeScore {
  score: number | null;
  reason: string;
}

export interface JudgeResult {
  judgement: JudgeScore;
  quality: JudgeScore;
}

/** A score at or above this passes its tier. */
export const JUDGE_PASS = 0.5;

const verdict = z.object({
  judgement: z.object({ score: z.number().min(0).max(1), reason: z.string() }),
  quality: z.object({ score: z.number().min(0).max(1), reason: z.string() }),
});

/** The rubric. Kept short and concrete so a fixed judge grades the same way each time. */
export const JUDGE_RUBRIC = `You grade one reply of an assistant that can show interactive UI (A2UI surfaces) in a chat.

Grade two things, each from 0 to 1:

judgement: was UI used exactly where it helps?
- 1: UI where it conveys the answer better than prose (to illustrate, compare, explore, or collect input), prose alone for a quick fact, a short answer, or conversation.
- 0: UI for something prose says better, UI only as decoration, a surface that only holds text, or no UI where the user clearly needed it.

quality: is the reply good for the request?
- 1: the UI fits the request, is complete, sensibly laid out, and the prose around it is short and useful.
- 0: the UI misses what was asked, is confusing, or the reply is wrong.
- When app context is given, a good reply uses its data where it helps and does not contradict it or invent other facts in its place.

Reply with JSON only: {"judgement":{"score":<0..1>,"reason":"<one line>"},"quality":{"score":<0..1>,"reason":"<one line>"}}`;

/**
 * The surfaces as the user ends up seeing them: the operations replayed,
 * so a replaced component shows once in its last version and a deleted
 * surface is left out. One line per component with its props, then the
 * data writes.
 */
export function outlineSurfaces(
  out: SampleOutput,
  limit = 6000,
  reachable?: ReadonlyMap<string, readonly string[]>,
) {
  const lines: string[] = [];
  for (const surface of out.surfaces) {
    const components = new Map<string, Record<string, unknown>>();
    const data: string[] = [];
    let deleted = false;
    for (const op of surface.operations as Array<Record<string, any>>) {
      for (const component of op.createSurface?.components ??
        op.updateComponents?.components ??
        []) {
        components.set(component.id, component);
      }
      if (op.createSurface?.dataModel !== undefined) {
        data.push(`data / = ${JSON.stringify(op.createSurface.dataModel)}`);
      }
      if (op.updateDataModel) {
        data.push(
          `data ${op.updateDataModel.path} = ${JSON.stringify(op.updateDataModel.value)}`,
        );
      }
      if (op.deleteSurface) deleted = true;
    }
    if (deleted) continue;
    lines.push(`surface ${surface.surfaceId}:`);
    // Only what renders: components the root reaches, when the render check knows.
    const shown = reachable?.get(surface.surfaceId);
    for (const { id, component, ...props } of components.values()) {
      if (shown && !shown.includes(String(id))) continue;
      lines.push(`  ${id}: ${component} ${JSON.stringify(props)}`);
    }
    lines.push(...data.map((line) => `  ${line}`));
  }
  const text = lines.join("\n");
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

/** `text` cut to at most `maxBytes` UTF-8 bytes. */
function cutToBytes(text: string, maxBytes: number) {
  const bytes = Buffer.from(text, "utf8");
  return bytes.length <= maxBytes
    ? text
    : bytes.subarray(0, maxBytes).toString("utf8");
}

/**
 * The judge prompt of one sample. With the render checks, the outline shows
 * only the components that render. The prompt with the rubric stays within
 * MAX_JUDGE_TOKENS.input bytes, an upper bound on its tokens.
 */
export function judgePrompt(
  c: EvalCase,
  out: SampleOutput,
  checks: ReadonlyArray<{ surfaceId: string; reachable?: string[] }> = [],
) {
  const limit =
    MAX_JUDGE_TOKENS.input - Buffer.byteLength(JUDGE_RUBRIC, "utf8") - 200;
  const reachable = new Map(
    checks
      .filter((check) => check.reachable)
      .map((check) => [check.surfaceId, check.reachable!]),
  );
  // What the user reads: fences become their lifted prose and surface markers.
  const prose = out.visibleText.trim();
  // The app context gets a fifth of the room, shared by its entries.
  const context = caseContext(c);
  const contextRoom = context.length > 0 ? Math.floor(limit / 5) : 0;
  const rest = limit - contextRoom;
  const text = [
    `User request: ${cutToBytes(c.message, Math.floor(rest / 6))}`,
    ...context.map(
      (entry) =>
        `App context "${entry.description}":\n${cutToBytes(entry.value, Math.floor(contextRoom / context.length))}`,
    ),
    `Reply prose:\n${cutToBytes(prose, Math.floor(rest / 3)) || "(none)"}`,
    `Surfaces:\n${out.surfaces.length > 0 ? cutToBytes(outlineSurfaces(out, limit, reachable), Math.floor(rest / 2)) : "(none)"}`,
  ].join("\n\n");
  return cutToBytes(text, limit);
}

/** Parses the judge's JSON reply, also when it is wrapped in a fence. */
export function parseVerdict(text: string): JudgeResult | undefined {
  const body = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!body) return undefined;
  try {
    const parsed = verdict.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Grades one sample with the fixed judge. One retry on a reply that is not
 * the expected JSON; after that the scores are `null` with the reason
 * "judge failed", so a broken judge never looks like a bad reply.
 */
export async function judgeSample(
  model: LanguageModel,
  c: EvalCase,
  out: SampleOutput,
  checks: ReadonlyArray<{ surfaceId: string; reachable?: string[] }> = [],
): Promise<JudgeResult & { costTokens: { input: number; output: number } }> {
  const prompt = judgePrompt(c, out, checks);
  let input = 0;
  let output = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model,
        system: JUDGE_RUBRIC,
        prompt,
        temperature: 0,
        maxOutputTokens: MAX_JUDGE_TOKENS.output,
      });
      input += result.usage.inputTokens ?? 0;
      output += result.usage.outputTokens ?? 0;
      const parsed = parseVerdict(result.text);
      if (parsed) return { ...parsed, costTokens: { input, output } };
    } catch {
      // Retry once, then give up below.
    }
  }
  const failed = { score: null, reason: "judge failed" };
  return { judgement: failed, quality: failed, costTokens: { input, output } };
}

/** One sample to label by hand. */
export interface LabelRow {
  key: string;
  case: string;
  message: string;
  reply: string;
  surfaces: string;
  judge: { judgement: number | null; quality: number | null };
  /** Fill in: 0 or 1 for each tier. */
  human: { judgement: number | null; quality: number | null };
}

/** The agreement of the judge with the hand labels, per tier (labelled rows only). */
export function calibrate(rows: readonly LabelRow[]) {
  const agreement = (tier: "judgement" | "quality") => {
    const labelled = rows.filter(
      (r) => r.human[tier] !== null && r.judge[tier] !== null,
    );
    if (labelled.length === 0) return { agreement: null, labelled: 0 };
    const agreeing = labelled.filter(
      (r) => r.judge[tier]! >= JUDGE_PASS === r.human[tier]! >= JUDGE_PASS,
    ).length;
    return { agreement: agreeing / labelled.length, labelled: labelled.length };
  };
  return { judgement: agreement("judgement"), quality: agreement("quality") };
}

/** Reads a labels JSONL file. */
export function readLabels(file: string): LabelRow[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LabelRow);
}
