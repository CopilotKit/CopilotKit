import { readFileSync } from "node:fs";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { EvalCase } from "./cases";
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

Reply with JSON only: {"judgement":{"score":<0..1>,"reason":"<one line>"},"quality":{"score":<0..1>,"reason":"<one line>"}}`;

/** The surfaces as a short outline: one line per component with its props. */
export function outlineSurfaces(out: SampleOutput, limit = 6000) {
  const lines: string[] = [];
  for (const surface of out.surfaces) {
    lines.push(`surface ${surface.surfaceId}:`);
    for (const op of surface.operations as Array<Record<string, any>>) {
      const components =
        op.createSurface?.components ?? op.updateComponents?.components ?? [];
      for (const { id, component, ...props } of components) {
        lines.push(`  ${id}: ${component} ${JSON.stringify(props)}`);
      }
      if (op.updateDataModel) {
        lines.push(
          `  data ${op.updateDataModel.path} = ${JSON.stringify(op.updateDataModel.value)}`,
        );
      }
      if (op.createSurface?.dataModel) {
        lines.push(`  data / = ${JSON.stringify(op.createSurface.dataModel)}`);
      }
    }
  }
  const text = lines.join("\n");
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

/** The judge prompt of one sample. */
export function judgePrompt(c: EvalCase, out: SampleOutput) {
  const prose = out.text.replace(/```a2ui[\s\S]*?```/g, "[surface]").trim();
  return [
    `User request: ${c.message}`,
    `Reply prose:\n${prose || "(none)"}`,
    `Surfaces:\n${out.surfaces.length > 0 ? outlineSurfaces(out) : "(none)"}`,
  ].join("\n\n");
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
): Promise<JudgeResult & { costTokens: { input: number; output: number } }> {
  const prompt = judgePrompt(c, out);
  let input = 0;
  let output = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({
        model,
        system: JUDGE_RUBRIC,
        prompt,
        temperature: 0,
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
