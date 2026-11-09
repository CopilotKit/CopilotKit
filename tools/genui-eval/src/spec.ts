import { readFileSync, writeFileSync } from "node:fs";
import { defaultGenerativeUIPromptSpec } from "@copilotkit/shared";
import type { GenerativeUIPromptSpec } from "@copilotkit/shared";
import { z } from "zod";

const feature = z.enum([
  "functions",
  "noFunctions",
  "events",
  "templates",
  "checks",
  "agentCalls",
]);
const item = z.union([
  z.string(),
  z.object({ when: z.array(feature), items: z.array(z.string()) }).strict(),
]);
const section = z.object({
  intro: z.string(),
  whenToShow: z.string(),
  operations: z.array(item).optional(),
  rules: z.array(item),
});
const schemaSettings = z.object({
  notation: z.enum(["compact", "json-schema", "ts-signature", "lines"]),
  propDescriptions: z.boolean(),
  commonProps: z.boolean(),
});

/**
 * A prompt spec as a file may hold it: every key optional, filled from the
 * default. Strict at every level, so a typo ("whenToShw") is an error, not
 * a key that is silently dropped.
 */
const specFile = z
  .object({
    markdown: section.partial().strict(),
    tool: section.partial().strict(),
    schema: z
      .object({
        markdown: schemaSettings.partial().strict(),
        tool: schemaSettings.partial().strict(),
      })
      .partial()
      .strict(),
    descriptions: z.record(z.string()),
  })
  .partial()
  .strict();

/**
 * A full spec from a partial one: each given field replaces the default's.
 * Throws with the path of the first problem.
 */
export function completeSpec(value: unknown): GenerativeUIPromptSpec {
  const parsed = specFile.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid prompt spec: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  const base = defaultGenerativeUIPromptSpec();
  const given = parsed.data;
  return {
    markdown: { ...base.markdown, ...given.markdown },
    tool: { ...base.tool, ...given.tool },
    schema: {
      markdown: { ...base.schema.markdown, ...given.schema?.markdown },
      tool: { ...base.schema.tool, ...given.schema?.tool },
    },
    descriptions: { ...base.descriptions, ...given.descriptions },
  };
}

export function loadSpec(file: string): GenerativeUIPromptSpec {
  return completeSpec(JSON.parse(readFileSync(file, "utf8")));
}

export function saveSpec(file: string, spec: GenerativeUIPromptSpec) {
  writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
}
