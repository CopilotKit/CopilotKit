/**
 * The gate `<WhenFrameworkHas>` evaluates, shared by the live component
 * (components/when-framework-has.tsx) and the source-level filter that the
 * TOC, raw Markdown, and the selected-guide guard use
 * (`filterFrameworkScopedBlocks` in toc.ts). Keeping one predicate means the
 * HTML page and its Markdown can never keep different branches.
 */

/**
 * Integration fields a gate can read. Keep in sync with the optional fields
 * on `Integration` in `lib/registry.ts` and the manifest schema in
 * `showcase/shared/manifest.schema.json`. `language` and `slug` are always
 * set: `slug` gates one framework's own branch, for prose that depends on
 * that framework's Showcase sources.
 */
export const FRAMEWORK_GATE_FLAGS = [
  "a2ui_pattern",
  "a2ui_agent_form",
  "interrupt_pattern",
  "thread_persistence_pattern",
  "agent_config_pattern",
  "auth_pattern",
  "voice_backend_pattern",
  "language",
  "slug",
] as const;

export type FrameworkGateFlag = (typeof FRAMEWORK_GATE_FLAGS)[number];

export interface FrameworkGate {
  flag: string;
  /** Render when the flag strictly equals this value. */
  equals?: string;
  /** Render when the flag is null or missing. */
  absent?: boolean;
  /**
   * Space-separated values. Render when the flag is null, missing, or none
   * of them: the fallback branch for every framework the page's other
   * branches don't cover. The only fallback that works for `slug`, which is
   * never missing.
   */
  noneOf?: string;
}

function listValues(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

/** Why a gate is malformed; empty when it is well-formed. */
export function frameworkGateProblems(gate: FrameworkGate): string[] {
  const problems: string[] = [];
  if (!(FRAMEWORK_GATE_FLAGS as readonly string[]).includes(gate.flag)) {
    problems.push(`unsupported flag "${gate.flag}"`);
  }
  const modes = [
    gate.equals !== undefined,
    gate.absent === true,
    gate.noneOf !== undefined,
  ].filter(Boolean).length;
  if (modes !== 1) {
    problems.push("needs exactly one of equals, absent, or noneOf");
  }
  if (gate.noneOf !== undefined && listValues(gate.noneOf).length === 0) {
    problems.push("noneOf lists no values");
  }
  if ((gate.flag === "slug" || gate.flag === "language") && gate.absent) {
    problems.push(
      `${gate.flag} is never missing, so absent never renders; use noneOf for the fallback`,
    );
  }
  return problems;
}

/**
 * Whether the gated children render for `integration` (the active
 * framework's registry entry). No framework, or a malformed gate, renders
 * nothing.
 */
export function frameworkGateMatches(
  integration: object | null | undefined,
  gate: FrameworkGate,
): boolean {
  if (!integration) return false;
  if (frameworkGateProblems(gate).length > 0) return false;
  const value = (integration as Record<string, unknown>)[gate.flag];
  if (gate.absent) return value == null;
  if (gate.noneOf !== undefined) {
    return value == null || !listValues(gate.noneOf).includes(String(value));
  }
  return value != null && value === gate.equals;
}

/** Parse a gate from a `<WhenFrameworkHas ...>` opening tag's attributes. */
export function parseFrameworkGate(attrs: string): FrameworkGate {
  const read = (name: string) =>
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
  return {
    flag: read("flag") ?? "",
    equals: read("equals"),
    noneOf: read("noneOf"),
    absent: /\babsent\b/.test(attrs) ? true : undefined,
  };
}
