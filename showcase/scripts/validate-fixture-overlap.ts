/**
 * Substring-overlap verifier for aimock fixtures.
 *
 * aimock matches incoming chat completions by `userMessage` substring against
 * each fixture in order. If fixture A's `userMessage` is a substring of
 * fixture B's `userMessage`, then any prompt that's intended to match B will
 * also match A (depending on order). For canonical e2e suggestions we want
 * every chat-bearing demo to have a single substring-disjoint prompt — this
 * verifier enforces that property mechanically.
 *
 * Two failure kinds:
 *   - "pairwise": one fixture's userMessage is an inner substring of another's.
 *   - "noise":    a fixture's userMessage is itself a noise token (or contains
 *                 only noise tokens), making it indistinguishable from common
 *                 chat fragments like "hi", "help", "ok".
 *
 * The verifier is case-insensitive (substring match against lowercased text).
 * Pairwise overlaps where inner === outer are ignored (identical messages are
 * a duplicate-fixture concern, not a substring-bleed concern, and aimock's own
 * load-time validator surfaces those).
 *
 * The allowlist exists for *intentional* substring relationships — e.g. the
 * CrewAI startup probe matches `"Based on the following context, write a
 * concise"` before falling through to the generic `"report"` and `"plan"`
 * fixtures. Add an entry per (inner, outer) pair with a short reason.
 */

export type Fixture = {
  /** Source file, relative path. Used in error reporting. */
  source: string;
  /** Index inside the source file's `fixtures` array. */
  index: number;
  /** The userMessage substring. May be empty/null for non-userMessage matchers
   *  like `toolCallId`, `endpoint`. Such fixtures are ignored. */
  userMessage: string | null | undefined;
};

export type AllowlistEntry = {
  /** The shorter, inner substring. */
  inner: string;
  /** The longer string that contains `inner`. */
  outer: string;
  /** Free-form justification — required so future readers know why. */
  reason: string;
};

export type Allowlist = AllowlistEntry[];

export type Overlap =
  | {
      kind: "pairwise";
      inner: string;
      outer: string;
      innerSource: string;
      innerIndex: number;
      outerSource: string;
      outerIndex: number;
    }
  | {
      kind: "noise";
      inner: string;
      outer: string;
      innerSource: string;
      innerIndex: number;
      /** Always equal to innerSource for "noise". */
      outerSource: string;
      /** Always equal to innerIndex for "noise". */
      outerIndex: number;
    };

function isAllowlisted(
  inner: string,
  outer: string,
  allowlist: Allowlist,
): boolean {
  const innerLower = inner.toLowerCase();
  const outerLower = outer.toLowerCase();
  return allowlist.some(
    (entry) =>
      entry.inner.toLowerCase() === innerLower &&
      entry.outer.toLowerCase() === outerLower,
  );
}

/**
 * Find every substring-overlap and noise-token violation across the fixture
 * set. Returns an empty array iff the set is substring-disjoint and contains
 * no noise-token messages.
 *
 * The noise check fires when a fixture's userMessage, lowercased and trimmed,
 * exactly equals a noise token. Catching containment-overlap with noise tokens
 * is unnecessary — a userMessage like "hi from the popup test" is uniquely
 * identifiable as a longer string and the noise list isn't meant to ban
 * substrings, only ban *standalone* noise messages.
 */
export function findOverlaps(
  fixtures: Fixture[],
  allowlist: Allowlist,
  noise: string[],
): Overlap[] {
  const overlaps: Overlap[] = [];
  const noiseLower = new Set(noise.map((n) => n.toLowerCase()));

  // Filter to fixtures with a non-empty userMessage. Other matchers
  // (toolCallId, endpoint) are out of scope for this verifier.
  const usable = fixtures.filter(
    (f) =>
      typeof f.userMessage === "string" && f.userMessage.trim().length > 0,
  );

  // Noise check — exact-match against the noise list.
  for (const fixture of usable) {
    const message = (fixture.userMessage as string).trim().toLowerCase();
    if (noiseLower.has(message)) {
      overlaps.push({
        kind: "noise",
        inner: fixture.userMessage as string,
        outer: fixture.userMessage as string,
        innerSource: fixture.source,
        innerIndex: fixture.index,
        outerSource: fixture.source,
        outerIndex: fixture.index,
      });
    }
  }

  // Pairwise substring check — for every ordered pair (a, b) with a !== b,
  // flag if a is a substring of b (case-insensitive). Skip identical strings;
  // those are a duplicate-fixture concern, not a substring-bleed concern.
  for (let i = 0; i < usable.length; i++) {
    for (let j = 0; j < usable.length; j++) {
      if (i === j) continue;
      const a = usable[i];
      const b = usable[j];
      const aMsg = (a.userMessage as string).trim();
      const bMsg = (b.userMessage as string).trim();
      const aLower = aMsg.toLowerCase();
      const bLower = bMsg.toLowerCase();
      if (aLower === bLower) continue;
      if (bLower.includes(aLower)) {
        if (isAllowlisted(aMsg, bMsg, allowlist)) continue;
        overlaps.push({
          kind: "pairwise",
          inner: aMsg,
          outer: bMsg,
          innerSource: a.source,
          innerIndex: a.index,
          outerSource: b.source,
          outerIndex: b.index,
        });
      }
    }
  }

  return overlaps;
}

/** Format an overlap list for human-readable error output. */
export function formatOverlaps(overlaps: Overlap[]): string {
  if (overlaps.length === 0) return "";
  return overlaps
    .map((o) => {
      if (o.kind === "noise") {
        return `  [noise] ${o.innerSource}#${o.innerIndex}: "${o.inner}" is a noise token`;
      }
      return `  [pairwise] ${o.innerSource}#${o.innerIndex} "${o.inner}" ⊂ ${o.outerSource}#${o.outerIndex} "${o.outer}"`;
    })
    .join("\n");
}
