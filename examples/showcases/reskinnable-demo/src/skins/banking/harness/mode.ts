/**
 * Whether the long-running expense harness is wired into banking's agent.
 * SERVER-SAFE: plain `.ts`, no client directive, no JSX — `agent.ts` imports it,
 * so it must stay importable from the server-only agent registry.
 *
 * An unrecognised value THROWS rather than silently going `off`: a typo'd flag
 * that quietly disables the beat is the most confusing possible outcome on
 * stage, because every other symptom (pill present, agent answers, no error)
 * looks like a working demo that simply chose not to call the tool.
 *
 * `"tool"` names the ONE shape the harness ships in: a `defineTool` on banking's
 * classic agent (`harness/as-tool.ts`). An earlier revision also carried
 * `"factory"` and `"both"` for a second arm that routed a dedicated agent slot
 * instead; that arm was removed, so **`EXPENSE_HARNESS_MODE=factory` and `=both`
 * now throw** — deliberately, since silently treating them as `"tool"` would
 * hide a stale `.env` rather than surface it.
 *
 * Read per call rather than captured at module load, so a test can flip the env
 * between cases without re-importing.
 */
export type HarnessMode = "off" | "tool";

const MODES: readonly HarnessMode[] = ["off", "tool"];

export const harnessMode = (): HarnessMode => {
  const raw = process.env.EXPENSE_HARNESS_MODE;
  if (!raw) return "off";
  if ((MODES as readonly string[]).includes(raw)) return raw as HarnessMode;
  throw new Error(
    `EXPENSE_HARNESS_MODE=${raw} is not recognised. Use one of: ${MODES.join(", ")}.`,
  );
};

/** The harness as a tool on banking's classic agent. */
export const armAEnabled = (): boolean => harnessMode() === "tool";
