/**
 * Which arm(s) of the harness comparison are live. SERVER-SAFE: plain `.ts`, no
 * client directive, no JSX — `agent.ts` imports it, so it must stay importable
 * from the server-only agent registry.
 *
 * Both arms can run at once (`both`) because they occupy different agent slots —
 * that side-by-side is the sharpest demonstration of why AG-UI-native streaming
 * matters.
 *
 * An unrecognised value THROWS rather than silently going `off`: a typo'd flag
 * that quietly disables the beat is the most confusing possible outcome on
 * stage, because every other symptom (pill present, agent answers, no error)
 * looks like a working demo that simply chose not to call the tool.
 *
 * Read per call rather than captured at module load, so a test can flip the env
 * between cases without re-importing.
 */
export type HarnessMode = "off" | "tool" | "factory" | "both";

const MODES: readonly HarnessMode[] = ["off", "tool", "factory", "both"];

export const harnessMode = (): HarnessMode => {
  const raw = process.env.EXPENSE_HARNESS_MODE;
  if (!raw) return "off";
  if ((MODES as readonly string[]).includes(raw)) return raw as HarnessMode;
  throw new Error(
    `EXPENSE_HARNESS_MODE=${raw} is not recognised. Use one of: ${MODES.join(", ")}.`,
  );
};

/** Arm A: the harness as a tool on banking's classic agent. */
export const armAEnabled = (): boolean =>
  harnessMode() === "tool" || harnessMode() === "both";

/** Arm C: the routed factory agent in its own slot. */
export const armCEnabled = (): boolean =>
  harnessMode() === "factory" || harnessMode() === "both";
