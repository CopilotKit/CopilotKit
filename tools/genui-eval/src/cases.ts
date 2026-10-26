import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Preset } from "./config";

const evalCase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** The user's request. */
  message: z.string().min(1),
  /** The catalog of the run. Only the standard catalog for now. */
  catalog: z.literal("standard"),
  /** Capabilities and known risks, e.g. "chart", "form", "null-trap". */
  tags: z.array(z.string().min(1)).min(1),
  expect: z.object({
    /** True when a good answer shows UI, false when prose alone is right. */
    ui: z.boolean(),
    /** Components a good answer uses. */
    components: z.array(z.string()).optional(),
  }),
  /** Earlier turns, oldest first (the format allows multi-turn cases). */
  history: z
    .array(
      z.object({ role: z.enum(["user", "assistant"]), content: z.string() }),
    )
    .optional(),
});

export type EvalCase = z.infer<typeof evalCase>;
export type Split = "train" | "heldout";

const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));

/** Parses a JSONL case file. Throws with the line of the first problem. */
export function parseCases(text: string, file = "cases"): EvalCase[] {
  return text
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line !== "" && !line.startsWith("//"))
    .map(({ line, index }) => {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${(error as Error).message}`);
      }
      const parsed = evalCase.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `${file}:${index + 1}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
      }
      return parsed.data;
    });
}

/**
 * The cases of one split. The held-out split is the honest exam: it is
 * never used to change the prompt, and agents never read its file.
 */
export function loadCases(split: Split, dir = CASES_DIR): EvalCase[] {
  const file = `${dir}${split === "train" ? "train" : "heldout"}.jsonl`;
  return parseCases(readFileSync(file, "utf8"), file);
}

/** The cases a preset selects: all, or those with a tag. */
export function selectCases(
  cases: readonly EvalCase[],
  selector: Preset["cases"],
): EvalCase[] {
  if (selector === "all") return [...cases];
  const tag = selector.slice("tag:".length);
  return cases.filter((c) => c.tags.includes(tag));
}
