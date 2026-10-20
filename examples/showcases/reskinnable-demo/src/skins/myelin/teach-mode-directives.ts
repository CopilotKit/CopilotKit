/**
 * The strings the teach chain hands back to the agent, and the parsers the
 * cards use to render a human line over them on replay. One module so the
 * writer and the reader cannot drift (ported from commerce's).
 */

export function buildDemonstrationDirective({
  steps,
  rule,
}: {
  steps: string[];
  rule: string | null;
}): string {
  const observed = steps
    .map((label, index) => `${index + 1}. ${label}`)
    .join("\n");
  return (
    `The user finished after ${steps.length} ${steps.length === 1 ? "step" : "steps"}. ` +
    `Observed steps:\n${observed || "(nothing captured)"}\n` +
    (rule
      ? `The audience rule that worked was "${rule}".`
      : "No audience rule was captured.")
  );
}

export function readDemonstratedStepCount(result: unknown): number | null {
  if (typeof result !== "string") return null;
  const match = /^The user finished after (\d+) steps?\./.exec(result.trim());
  return match ? Number(match[1]) : null;
}

export const SAVE_PROCEDURE_CONFIRMED =
  "The user confirmed. Persist this with save_memory now (scope 'user', kind 'operational'), then say in one sentence that you have it.";

export const SAVE_PROCEDURE_DECLINED =
  "The user declined to save it. Do not call save_memory.";

export type SaveProcedureOutcome = "pending" | "saved" | "declined" | "unknown";

export function classifySaveProcedureResult(
  result: unknown,
): SaveProcedureOutcome {
  if (typeof result !== "string") return "pending";
  const text = result.trim();
  if (text.length === 0) return "pending";
  if (text === SAVE_PROCEDURE_CONFIRMED) return "saved";
  if (text === SAVE_PROCEDURE_DECLINED) return "declined";
  if (/declined|do not call save_memory/i.test(text)) return "declined";
  if (/confirmed/i.test(text) && /save_memory/i.test(text)) return "saved";
  return "unknown";
}
