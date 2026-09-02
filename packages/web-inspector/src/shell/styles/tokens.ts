/** Tone drives colour only. The launcher treatment is shared by every tone. */
export type LauncherSignalTone = "news" | "error";

const NEWS_SIGNAL_COLOR = "#A78BFA";
/**
 * The error tone's red. Bright enough to read against the launcher's dark
 * face at the same perceived weight as the news lilac, and in the same family
 * as System Health's error tone (#b32d3b light / #ff9aa0 dark), which is too
 * dark and too pale respectively to use directly on the launcher.
 */
const ERROR_SIGNAL_COLOR = "#F87171";

export const LAUNCHER_SIGNAL_COLORS: Readonly<
  Record<LauncherSignalTone, string>
> = {
  news: NEWS_SIGNAL_COLOR,
  error: ERROR_SIGNAL_COLOR,
};

// The launcher keeps its current touch target on compact screens and grows to
// an exactly 20% larger desktop cap. `box-sizing` makes these OUTER sizes.
export const LAUNCHER_MIN_SIZE = 51.84;
export const LAUNCHER_MAX_SIZE = 62.208;
