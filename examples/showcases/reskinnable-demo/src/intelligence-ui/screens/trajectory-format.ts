/** Formatting shared by the Intelligence list screens. */
import type { TrajectoryOutcome } from "../data/contract";

const pad = (n: number): string => String(n).padStart(2, "0");

export const fmtTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
};

export function outcomeText(outcome: TrajectoryOutcome): string {
  if (outcome === "agent_failed_user_completed") return "Agent failed · user completed";
  if (outcome === "agent_succeeded") return "Agent succeeded";
  return "In progress";
}

export const surfaceName = (surface: string): string =>
  surface === "chatgpt" ? "ChatGPT" : surface === "in_app" ? "In-app agent" : "Manual";
