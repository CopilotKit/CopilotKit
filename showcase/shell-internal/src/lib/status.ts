import statusData from "../../../shell/src/data/status.json";

export type TestState = "pass" | "fail";
export type HealthState = "up" | "down" | "unknown";

export interface TestResult {
  status: TestState;
  ran_at: string;
  url: string;
}
export interface QAResult {
  reviewed_at: string;
  url: string;
}
export interface HealthResult {
  status: HealthState;
  checked_at: string;
}

export interface Variant {
  name: string;
  e2e: TestResult | null;
  smoke: TestResult | null;
  qa: QAResult | null;
  health: HealthResult;
}
export interface DemoStatus {
  e2e: TestResult | null;
  smoke: TestResult | null;
  qa: QAResult | null;
  health: HealthResult;
  variants?: Variant[];
}

export interface StatusBundle {
  generated_at: string;
  integrations: Record<string, { demos: Record<string, DemoStatus> }>;
}

const status = statusData as unknown as StatusBundle;

// Freshness thresholds (ms) — all render-time decisions.
export const TEST_FRESH_MS = 6 * 3600 * 1000; // 6h: E2E/Smoke "fresh" cutoff
export const QA_GREEN_MS = 7 * 86400 * 1000; // 7d: QA green cutoff
export const QA_AMBER_MS = 30 * 86400 * 1000; // 30d: QA amber cutoff
export const BUNDLE_USABLE_MS = 24 * 3600 * 1000; // 24h: bundle freshness

export function getDemoStatus(slug: string, demoId: string): DemoStatus | null {
  return status.integrations[slug]?.demos?.[demoId] ?? null;
}

export function isBundleStale(now: number = Date.now()): boolean {
  const age = now - new Date(status.generated_at).getTime();
  return age > BUNDLE_USABLE_MS;
}

export function bundleGeneratedAt(): string {
  return status.generated_at;
}

// Badge state computation. Single source of truth for the cell renderer.
export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue";

export function testBadge(
  result: TestResult | null,
  bundleStale: boolean,
): { label: string; tone: BadgeTone } {
  if (bundleStale) return { label: "?", tone: "gray" };
  if (!result) return { label: "✗", tone: "red" };
  if (result.status === "fail") return { label: "✗", tone: "red" };
  const age = Date.now() - new Date(result.ran_at).getTime();
  return { label: "✓", tone: age <= TEST_FRESH_MS ? "green" : "amber" };
}

export function qaBadge(
  result: QAResult | null,
  bundleStale: boolean,
): { label: string; tone: BadgeTone } {
  if (bundleStale) return { label: "?", tone: "gray" };
  if (!result) return { label: "✗", tone: "red" };
  const ageMs = Date.now() - new Date(result.reviewed_at).getTime();
  const days = Math.floor(ageMs / 86400000);
  const tone: BadgeTone =
    ageMs <= QA_GREEN_MS ? "green" : ageMs <= QA_AMBER_MS ? "amber" : "red";
  return { label: `${days}d`, tone };
}

export function healthBadge(
  result: HealthResult,
  bundleStale: boolean,
): { label: string; tone: BadgeTone } {
  if (bundleStale) return { label: "?", tone: "gray" };
  if (result.status === "up") return { label: "up", tone: "green" };
  if (result.status === "down") return { label: "down", tone: "red" };
  return { label: "?", tone: "gray" };
}

// ─────────────── variant helpers ───────────────

export function getDemoVariants(
  slug: string,
  demoId: string,
): Variant[] | null {
  return getDemoStatus(slug, demoId)?.variants ?? null;
}

// Aggregate a set of tone strings to a single worst-case tone.
// Priority: red > amber > gray > green (i.e. anything non-green dominates).
const TONE_PRIORITY: Record<BadgeTone, number> = {
  red: 4,
  amber: 3,
  gray: 2,
  green: 1,
  blue: 0,
};
export function worstTone(tones: BadgeTone[]): BadgeTone {
  if (tones.length === 0) return "gray";
  return tones.reduce((worst, t) =>
    TONE_PRIORITY[t] > TONE_PRIORITY[worst] ? t : worst,
  );
}

// Count the number of variants whose `getTone` returns a "passing" tone
// (green or amber — i.e. has a real result, not red/gray).
export function passCount(
  variants: Variant[],
  bundleStale: boolean,
  kind: "e2e" | "smoke" | "qa" | "health",
): { pass: number; total: number } {
  let pass = 0;
  for (const v of variants) {
    let tone: BadgeTone = "gray";
    if (kind === "e2e") tone = testBadge(v.e2e, bundleStale).tone;
    else if (kind === "smoke") tone = testBadge(v.smoke, bundleStale).tone;
    else if (kind === "qa") tone = qaBadge(v.qa, bundleStale).tone;
    else if (kind === "health") tone = healthBadge(v.health, bundleStale).tone;
    if (tone === "green" || tone === "amber") pass++;
  }
  return { pass, total: variants.length };
}
