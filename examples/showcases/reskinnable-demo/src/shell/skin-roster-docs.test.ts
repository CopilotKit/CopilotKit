import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { skinIds } from "./skins-config";

/**
 * The prose drift guard.
 *
 * `skins-config.test.ts` (its neighbour) stops the three CODE copies of the skin
 * id list from rotting. This file stops the PROSE copies from rotting, which is
 * the same defect class and the one that actually keeps shipping: a doc hardcodes
 * a skin count or a skin roster, the registered set grows, and the sentence turns
 * false with nothing to catch it. One CR pass over the `commerce` skin found
 * FOURTEEN live instances of exactly that across six documents — "ships four of
 * them", "these four", a four-value `LOCK_SKIN` list, "all four stay reachable",
 * "a four-tenant demo harness", "the unlocked four-skin demo", and so on.
 *
 * CLAUDE.md already carries a standing rule telling the next author to re-read
 * the reskin skill after every change, and it explains why the rot is invisible:
 * "it goes stale SILENTLY — nothing type-checks it, no test imports it, and a
 * skin built from a stale template still compiles, lints and renders." That rule
 * was written BEFORE the fourteen instances, so prose discipline has already been
 * tried and has already failed. This file is the mechanical replacement.
 *
 * The expected values are DERIVED from `skinIds`; the digit 6 and the word "six"
 * appear nowhere below, or this test would become the fifteenth instance of the
 * bug it exists to prevent.
 *
 * ── Coverage, stated honestly ────────────────────────────────────────────────
 *
 * COVERED: the six documents in `DOC_SET` below, for (a) count claims that assert
 * the size of the shipped set, and (b) inline id enumerations that the doc frames
 * as the valid/registered set.
 *
 * ── TWO FALSE POSITIVES THIS FILE SHIPPED WITH, both fixed ───────────────────
 *
 * A drift guard that fails CORRECT prose is worse than none: it trains the next
 * author to reach for an exemption. This file was originally validated only
 * against the tree as it stood, which is the weaker test — it proved that no
 * CURRENT sentence trips a rule, not that no LEGITIMATE sentence does. Two
 * legitimate sentences did:
 *
 *  1. **"the sixth skin"** — a TRUE reference to `commerce` — was flagged as a
 *     stale count, because the ordinal rule assumed every ordinal names the
 *     HYPOTHETICAL NEXT skin (`registered + 1`). That holds for the indefinite
 *     article ("a fifth skin added to the registry…", the phrasing the rule was
 *     built from) and not for the definite one, which names an EXISTING member.
 *     The article now decides, and a numeral equal to the registered count is
 *     never treated as stale under either reading.
 *  2. **A deliberate partial glob** — `src/skins/{banking,people}/…` — was flagged
 *     as an incomplete roster, because the brace-glob rule demanded exhaustiveness
 *     with no totality framing at all, while the id-list rule (correctly) required
 *     one. Globs now need the same framing, from a cue window on EITHER side: the
 *     two real globs are framed by "the six shipped skins" BEFORE (templates.md)
 *     and "six implementations" AFTER (CLAUDE.md).
 *
 * Both discriminators are pinned below by must-flag AND must-not-flag fixtures,
 * so neither can be quietly widened back.
 *
 * NOT COVERED, deliberately:
 *
 *  - **Subset counts** ("the four REST-backed skins", "the three demo-complete
 *    skins", "all three skins have one"). These are true statements about a
 *    subset, and a subset size is not derivable from the registry, so asserting
 *    on them would only produce false alarms. `COUNT_EXEMPTIONS` below carries
 *    the one subset phrase whose grammar is indistinguishable from a total claim.
 *  - **Per-skin counts** — gen-UI registration counts, suggestion-pill counts,
 *    beat counts ("nine beats", "the three skins at 9/9"). Not skin-roster
 *    claims; verifying them would mean parsing each skin's source.
 *  - **Two known instances OUTSIDE the doc set**, both classified as follow-up
 *    work for a separate PR and both still stale as of this file's commit:
 *      1. `src/proxy.ts` — a comment saying "the other three skins".
 *      2. `e2e/inset-layout.spec.ts` — a loop over a hardcoded four-skin list, so
 *         the shell frame is never e2e-verified for `people` or `commerce`.
 *    They are named here rather than checked because adding them would make this
 *    test red on a tree the rest of the PR considers converged. Whoever fixes
 *    them should consider widening `DOC_SET`/adding a source-comment sweep here.
 */

/** Walks up from this file to the app root (the dir holding package.json + the skill). */
function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, ".claude", "skills", "reskin"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "could not locate the reskinnable-demo app root from " + import.meta.url,
  );
}

const DOC_SET = [
  "CLAUDE.md",
  "README.md",
  ".env.example",
  ".claude/skills/reskin/SKILL.md",
  ".claude/skills/reskin/demo-beats.md",
  ".claude/skills/reskin/templates.md",
] as const;

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const ORDINAL_WORDS: Record<string, number> = {
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};
/** Group-free alternations, so they can be embedded more than once per pattern. */
const NUM_ALT = `(?:${Object.keys(NUMBER_WORDS).join("|")}|[2-9]|1[0-2])`;
const ORD_ALT = `(?:${Object.keys(ORDINAL_WORDS).join("|")})`;
/** The claimed numeral, always captured as `num` so one reader serves every rule. */
const NUM = `(?<num>${NUM_ALT})`;
const ORD = `(?<num>${ORD_ALT})`;
const MENTIONS_SKIN = /\bskins?\b/i;

/**
 * Each rule matches a phrase shape that asserts the SIZE OF THE SHIPPED SET, and
 * only that shape — the discriminator is that a subset claim is virtually always
 * qualified ("four REST-backed skins", "five of the six skins"), so a bare number
 * fused to a totality cue is the total. Every historical instance is listed with
 * the rule that catches it; `catches` doubles as the synthetic red fixture in the
 * self-test at the bottom, so a refactor that keeps the list but breaks a regex
 * fails too.
 */
type CountRule = {
  id: string;
  re: RegExp;
  /** Require /skins?/ in the N chars AFTER the match. */
  skinAfter?: number;
  /** Require /skins?/ within N chars either side of the match. */
  skinAround?: number;
  /**
   * Is `claimed` a TRUE statement given `registered`? Defaults to "exactly the
   * registered count". A rule overrides this only when its phrase shape admits
   * more than one true reading — see `ordinal-skin`, whose original single
   * reading flagged the truthful "the sixth skin".
   */
  accepts?: (
    claimed: number,
    registered: number,
    m: RegExpExecArray,
  ) => boolean;
  /** How the failure message describes what WOULD have been true. */
  expectation?: (registered: number, m: RegExpExecArray) => string;
  catches: string[];
};

/** Was the ordinal introduced by "the" (an existing member) or "a" (the next one)? */
const isDefinite = (m: RegExpExecArray) =>
  m.groups?.art?.toLowerCase() === "the";

const COUNT_RULES: CountRule[] = [
  {
    id: "ships-N-skins",
    re: new RegExp(
      `\\b(?:ships?|shipped|shipping)\\s+${NUM}\\s+skins?\\b`,
      "gi",
    ),
    catches: ["the app ships four skins rather than two"],
  },
  {
    id: "today-N-skins",
    re: new RegExp(`\\btoday\\s+${NUM}\\s+skins?\\b`, "gi"),
    catches: ["`src/shell/registry.ts` — today four skins:"],
  },
  {
    id: "the-N-skins",
    re: new RegExp(
      `\\bthe\\s+${NUM}\\s+(?:shipped\\s+|registered\\s+)?skins?\\b`,
      "gi",
    ),
    catches: [
      "## The four skins (why they differ)",
      "read the four shipped skins as worked references",
      "mirror the four shipped skins (`src/skins/{banking,airline,logistics,keel}/`)",
    ],
  },
  {
    id: "N-are-registered",
    re: new RegExp(`\\b${NUM}\\s+(?:skins?\\s+)?are\\s+registered\\b`, "gi"),
    catches: [
      "Four are registered — `banking`, `airline`, `logistics`, `keel`",
    ],
  },
  {
    id: "N-compound-noun",
    re: new RegExp(`\\b${NUM}-(?:skin|tenant|brand|product|domain)\\b`, "gi"),
    catches: [
      "Skins live under `/[skin]` on the normal four-skin demo",
      "reads as a product rather than as a four-tenant demo harness",
      "one build serves both a locked single-tenant host and the unlocked four-skin demo",
    ],
  },
  {
    id: "all-N-skins",
    re: new RegExp(
      `\\ball\\s+${NUM}\\s+(?:skins?|agents?|stay|remain)\\b`,
      "gi",
    ),
    catches: [
      "the normal multi-skin demo: all four skins reachable, the switcher visible",
      "NOT a security boundary: all four agents stay registered server-side",
      "Unset — the default — all four stay reachable under `/<id>`",
    ],
  },
  {
    id: "these-N",
    re: new RegExp(`\\bthese\\s+${NUM}\\b`, "gi"),
    skinAfter: 80,
    catches: ["These four run behind the **same** `Skin` contract on purpose"],
  },
  {
    id: "N-of-them",
    re: new RegExp(`\\b${NUM}\\s+of\\s+them\\b`, "gi"),
    skinAround: 140,
    catches: [
      "hosts one **skin** per route segment `/[skin]/...`, and ships four of them:",
    ],
  },
  {
    id: "ordinal-skin",
    re: new RegExp(`\\b(?<art>an?|the)\\s+${ORD}\\s+skin\\b`, "gi"),
    // THE ARTICLE CARRIES THE CLAIM, and conflating the two readings is what made
    // this rule flag a truthful sentence:
    //  - "A fifth skin added to the registry…" — INDEFINITE, so it is the
    //    hypothetical NEXT skin and must name `registered + 1`. (`registered`
    //    itself is also accepted: a numeral that equals the shipped count is not
    //    stale under any reading, and refusing it is how a doc gets pushed into
    //    an exemption for being right.)
    //  - "the sixth skin" — DEFINITE, so it names an EXISTING member. Any ordinal
    //    from first to `registered` is a true statement about the roster; only an
    //    ordinal PAST the end claims a skin that does not exist.
    accepts: (claimed, registered, m) =>
      isDefinite(m)
        ? claimed >= 1 && claimed <= registered
        : claimed === registered + 1 || claimed === registered,
    expectation: (registered, m) =>
      isDefinite(m)
        ? `an ordinal no greater than ${registered}`
        : `${registered + 1}`,
    catches: [
      "A fifth skin added to the registry and not to `skinIds` fails HERE",
    ],
  },
];

/**
 * Subset claims whose grammar is identical to a total claim, so the rules above
 * cannot tell them apart. Each entry must still be FOUND in its file — a stale
 * exemption fails its own test rather than silently widening into a blanket
 * suppression.
 */
const COUNT_EXEMPTIONS: { file: string; phrase: string; why: string }[] = [
  {
    file: ".claude/skills/reskin/templates.md",
    phrase: "All three skins have one",
    why:
      "TRUE subset: the skins that ship intelligence/forget-memories.ts " +
      "(banking, people, commerce), not the registered roster.",
  },
];

/** A backticked/bolded skin id, as the docs write them. */
const ID_TOKEN = `(?:\\*\\*)?\`?(?:${skinIds.join("|")})\`?(?:\\*\\*)?`;
/** `,` `|` `/` `and` `or` — optionally across a wrapped line. */
const ID_SEP = `(?:\\s*[,|/]\\s*|\\s*,?\\s+(?:and|or)\\s+)`;
const ID_LIST = new RegExp(`${ID_TOKEN}(?:${ID_SEP}${ID_TOKEN})+`, "gi");
/** `{banking,airline,…}` shell-glob form, e.g. in a path reference. */
const ID_BRACE_GLOB = /\{([a-z][a-z,\s]*)\}/gi;
/**
 * An id list is only required to be COMPLETE when the doc frames it as the valid
 * or registered set. Every other list in these docs is a deliberate subset
 * ("banking, people and commerce are demo-complete"), which is why the cue is
 * this narrow: broadening it to a bare "registered" immediately false-positives
 * on CLAUDE.md's TRUE history sentence about `people` and `commerce` shipping.
 */
const EXHAUSTIVE_CUE = /valid ids?|registered set|are registered|LOCK_SKIN/i;
const CUE_LOOKBEHIND = 140;

/**
 * Totality framing for a brace GLOB, which needs its own cue vocabulary: a path
 * glob is framed by prose about the skins it points at ("mirror the six shipped
 * skins", "— six implementations"), not by the "valid ids" wording that frames an
 * inline id list. Without this, every partial glob was demanded to be exhaustive
 * — a verified false positive on a deliberate two-member glob.
 *
 * The window spans BOTH sides because the two real globs are framed on opposite
 * sides: templates.md's cue precedes it, CLAUDE.md's follows it.
 */
const GLOB_TOTALITY_CUE = new RegExp(
  [
    EXHAUSTIVE_CUE.source,
    `\\b(?:all|every|each)\\s+(?:${NUM_ALT}\\s+)?(?:shipped\\s+|registered\\s+)?skins?\\b`,
    `\\b${NUM_ALT}\\s+(?:shipped\\s+|registered\\s+)?(?:skins?|implementations?)\\b`,
  ].join("|"),
  "i",
);
const GLOB_CUE_WINDOW = 160;

type Hit = {
  line: number;
  phrase: string;
  claimed: number;
  /** What would have been true, as prose — some rules admit more than one value. */
  expected: string;
  rule: string;
};

/** Blanks `# ` comment prefixes (offset-preserving) so .env.example prose reads as prose. */
function unwrapComments(text: string): string {
  return text.replace(/\n#( ?)/g, (m) => "\n" + " ".repeat(m.length - 1));
}

const lineAt = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

/** Count claims about the shipped set that disagree with `registered`. */
export function findStaleCountClaims(
  source: string,
  registered: number,
  exempt: string[] = [],
): Hit[] {
  const text = unwrapComments(source);
  // Exemptions are matched by POSITION, not by substring: an exempted sentence is
  // longer than the phrase a rule matches inside it, so a naive substring compare
  // would never fire — and comparing the other way round would let the exemption
  // silence the same wording everywhere else in the file.
  const exemptSpans: [number, number][] = exempt.flatMap((phrase) => {
    const spans: [number, number][] = [];
    for (
      let at = text.indexOf(phrase);
      at !== -1;
      at = text.indexOf(phrase, at + 1)
    ) {
      spans.push([at, at + phrase.length]);
    }
    return spans;
  });
  const isExempt = (index: number) =>
    exemptSpans.some(([start, end]) => index >= start && index < end);
  const hits: Hit[] = [];
  for (const rule of COUNT_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      if (
        rule.skinAfter !== undefined &&
        !MENTIONS_SKIN.test(text.slice(end, end + rule.skinAfter))
      ) {
        continue;
      }
      if (
        rule.skinAround !== undefined &&
        !MENTIONS_SKIN.test(
          text.slice(
            Math.max(0, m.index - rule.skinAround),
            end + rule.skinAround,
          ),
        )
      ) {
        continue;
      }
      const token = (m.groups?.num ?? "").toLowerCase();
      const claimed =
        ORDINAL_WORDS[token] ?? NUMBER_WORDS[token] ?? Number(token);
      const accepts = rule.accepts ?? ((c: number, reg: number) => c === reg);
      if (accepts(claimed, registered, m)) continue;
      if (isExempt(m.index)) continue;
      const phrase = m[0].replace(/\s+/g, " ");
      hits.push({
        line: lineAt(text, m.index),
        phrase,
        claimed,
        expected: rule.expectation
          ? rule.expectation(registered, m)
          : String(registered),
        rule: rule.id,
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** Id enumerations the doc presents as the whole set, but which omit a registered id. */
export function findIncompleteRosters(
  source: string,
  ids: readonly string[],
): { line: number; phrase: string; missing: string[]; rule: string }[] {
  const text = unwrapComments(source);
  const found: {
    line: number;
    phrase: string;
    missing: string[];
    rule: string;
  }[] = [];
  const record = (
    index: number,
    phrase: string,
    listed: string[],
    rule: string,
  ) => {
    const missing = ids.filter((id) => !listed.includes(id));
    found.push({
      line: lineAt(text, index),
      phrase: phrase.replace(/\s+/g, " "),
      missing,
      rule,
    });
  };

  const glob = new RegExp(ID_BRACE_GLOB.source, ID_BRACE_GLOB.flags);
  let g: RegExpExecArray | null;
  while ((g = glob.exec(text))) {
    const members = g[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Only a glob whose every member is a skin id is a roster; `{ createAgent,
    // identifyUser? }` and friends are not.
    if (members.length < 2 || !members.every((s) => ids.includes(s))) continue;
    // …and only one the doc FRAMES as the whole set. `src/skins/{banking,people}/`
    // as a pointer at two worked examples is not a roster claim, and demanding
    // exhaustiveness there was a false positive on legitimate prose.
    if (
      !GLOB_TOTALITY_CUE.test(
        text.slice(
          Math.max(0, g.index - GLOB_CUE_WINDOW),
          g.index + g[0].length + GLOB_CUE_WINDOW,
        ),
      )
    ) {
      continue;
    }
    record(g.index, g[0], members, "brace-glob");
  }

  const list = new RegExp(ID_LIST.source, ID_LIST.flags);
  const anyId = new RegExp(ids.join("|"), "g");
  let m: RegExpExecArray | null;
  while ((m = list.exec(text))) {
    const listed = [...new Set(m[0].toLowerCase().match(anyId) ?? [])];
    if (listed.length < 2) continue;
    if (
      !EXHAUSTIVE_CUE.test(
        text.slice(Math.max(0, m.index - CUE_LOOKBEHIND), m.index),
      )
    ) {
      continue;
    }
    record(m.index, m[0], listed, "valid-id-list");
  }
  return found.sort((a, b) => a.line - b.line);
}

const ROOT = appRoot();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
// Derived, never literal. `skins-config.test.ts` proves `skinIds` equals the
// registry's keys, so this is the registered set.
const REGISTERED = skinIds.length;
const ROSTER = `${REGISTERED} skins are registered (${skinIds.join(", ")})`;

describe("the documented skin roster", () => {
  it("checks every file it claims to check", () => {
    // A renamed or moved doc must not silently drop out of coverage.
    expect(DOC_SET.filter((rel) => !existsSync(join(ROOT, rel)))).toEqual([]);
  });

  it("states no skin count that contradicts the registered set", () => {
    const failures = DOC_SET.flatMap((rel) => {
      const exempt = COUNT_EXEMPTIONS.filter((e) => e.file === rel).map(
        (e) => e.phrase,
      );
      return findStaleCountClaims(read(rel), REGISTERED, exempt).map(
        (h) =>
          `${rel}:${h.line} says "${h.phrase}" — that claims ${h.claimed}, where ` +
          `${h.expected} would be true; ${ROSTER}. [rule: ${h.rule}] Fix the ` +
          `sentence, or phrase it without a numeral so the next skin cannot ` +
          `re-falsify it.`,
      );
    });
    expect(failures).toEqual([]);
  });

  it("keeps every enumeration of the valid skin ids complete", () => {
    const rosters = DOC_SET.flatMap((rel) =>
      findIncompleteRosters(read(rel), skinIds).map((h) => ({ rel, ...h })),
    );
    // Guard the guard: if the patterns stop matching anything, the check above
    // passes vacuously. The docs do enumerate the roster, in several places — and
    // in BOTH shapes, so requiring both catches ONE rule going blind, which the
    // bare count would not.
    //
    // STATED HONESTLY: this proves each rule still fires SOMEWHERE, not that every
    // glob is covered. The brace-glob rule needs totality framing near the glob
    // (deliberately, so a partial glob is not demanded to be exhaustive), so a
    // single doc rephrased away from that framing drops out of coverage while the
    // other doc's glob keeps this assertion green. Verified: removing
    // templates.md's "the six shipped skins" leaves the suite passing.
    expect(rosters.length).toBeGreaterThan(2);
    expect([...new Set(rosters.map((h) => h.rule))].sort()).toEqual([
      "brace-glob",
      "valid-id-list",
    ]);
    expect(
      rosters
        .filter((h) => h.missing.length > 0)
        .map(
          (h) =>
            `${h.rel}:${h.line} lists the valid skin ids as "${h.phrase}" but omits ` +
            `${h.missing.join(", ")} — ${ROSTER}. [rule: ${h.rule}]`,
        ),
    ).toEqual([]);
  });

  it("carries no dead count-claim exemption", () => {
    // An exemption that no longer matches its file is a suppression nobody reads;
    // it must be deleted (or the prose it excused restored) rather than left to rot.
    expect(
      COUNT_EXEMPTIONS.filter((e) => !read(e.file).includes(e.phrase)).map(
        (e) => `${e.file} no longer contains the exempted phrase "${e.phrase}"`,
      ),
    ).toEqual([]);
  });
});

describe("the roster checks themselves", () => {
  // The red half of red-green, kept permanently. Every string below is the ACTUAL
  // stale wording that shipped in one of these six documents (or, for two of
  // them, in src/lib/locked-skin.ts and skins-config.test.ts) and was fixed in
  // the CR pass that motivated this file. If a regex is loosened or broken, the
  // instance it used to catch fails here.
  it.each(COUNT_RULES.flatMap((r) => r.catches.map((c) => [r.id, c] as const)))(
    "still catches the %s instance: %s",
    (ruleId, phrase) => {
      const hits = findStaleCountClaims(phrase, REGISTERED);
      expect(hits.map((h) => h.rule)).toContain(ruleId);
      // The message has to name the number it read and the number it expected.
      expect(hits[0].claimed).not.toBe(REGISTERED);
    },
  );

  it("passes a count that matches the registered set", () => {
    const word = Object.keys(NUMBER_WORDS).find(
      (w) => NUMBER_WORDS[w] === REGISTERED,
    );
    expect(word).toBeDefined();
    expect(
      findStaleCountClaims(`the app ships ${word} skins`, REGISTERED),
    ).toEqual([]);
  });

  it("passes a TRUTHFUL count in every phrasing a rule matches", () => {
    // The test the original should have carried. Validating only against today's
    // tree proves that no CURRENT sentence trips a rule — not that no CORRECT
    // sentence does. These are the shapes of all nine rules, written truthfully
    // and DERIVED from the registry, so they stay truthful as skins are added.
    const n = REGISTERED;
    const word = Object.keys(NUMBER_WORDS).find((w) => NUMBER_WORDS[w] === n);
    const nextOrdinal = Object.keys(ORDINAL_WORDS).find(
      (w) => ORDINAL_WORDS[w] === n + 1,
    );
    const lastOrdinal = Object.keys(ORDINAL_WORDS).find(
      (w) => ORDINAL_WORDS[w] === n,
    );
    expect([word, nextOrdinal, lastOrdinal].every(Boolean)).toBe(true);
    const truthful = [
      `the app ships ${word} skins`,
      `\`src/shell/registry.ts\` — today ${n} skins:`,
      `## The ${word} skins (why they differ)`,
      `${word} are registered — see \`skinIds\``,
      `the unlocked ${word}-skin demo`,
      `all ${word} skins reachable, the switcher visible`,
      `These ${word} run behind the **same** \`Skin\` contract on purpose`,
      `hosts one **skin** per route segment, and ships ${word} of them:`,
      // Both readings of an ordinal, which is the discriminator this rule turns
      // on: the definite one names a member that EXISTS, the indefinite one the
      // hypothetical next.
      `the ${lastOrdinal} skin is the newest one`,
      `a ${nextOrdinal} skin added to the registry and not to \`skinIds\` fails HERE`,
      // A definite ordinal BELOW the count is still a true statement.
      "the fourth skin in registry order",
    ];
    expect(
      truthful.flatMap((text) =>
        findStaleCountClaims(text, REGISTERED).map(
          (h) => `${h.rule} flagged "${h.phrase}" in "${text}"`,
        ),
      ),
    ).toEqual([]);
  });

  it("still flags an ordinal past the end of the roster", () => {
    // The other half of the article discriminator: "the sixth skin" is true on a
    // six-skin registry, "the seventh" claims a skin that does not exist. Without
    // this, relaxing the definite reading would have opened a hole.
    const past = Object.keys(ORDINAL_WORDS).find(
      (w) => ORDINAL_WORDS[w] === REGISTERED + 1,
    );
    const hits = findStaleCountClaims(`the ${past} skin`, REGISTERED);
    expect(hits.map((h) => h.rule)).toEqual(["ordinal-skin"]);
    expect(hits[0].claimed).toBe(REGISTERED + 1);
  });

  it("ignores the legitimate phrasings that must never be flagged", () => {
    // Verbatim from the current docs. Each is TRUE and must stay as written:
    // past-tense incident history, beat vocabulary, subset counts qualified by an
    // adjective, and numbers about things that are not skins.
    const legitimate = [
      "naming four skins for two releases after `people` and `commerce` shipped",
      "it named four skins for two releases after `people` and `commerce` shipped",
      "Absent instructions, build all nine rows",
      "`banking`, `people` or `commerce` — the only three at 9/9 beats",
      "Set by the four REST-backed skins — banking, people and commerce",
      "**This is the standard mechanism for the two in-memory skins**",
      "That is five of the six skins; **airline** is the only one that omits it",
      "The gated `dev/reset` route is the wider set: four skins have one",
      "The ask is 8–12 skins spanning that space",
      "banking, logistics, keel, people and commerce all five ship them",
      "All four appends are guarded: `skins-config.test.ts` fails on any of them",
      "the same grep as rule 3 passed on all seven",
      "the second skin built demo-complete against the full beat list",
      "a 600/1000-em advance width",
      "Two registries, one id",
    ];
    expect(
      legitimate.flatMap((text) =>
        findStaleCountClaims(text, REGISTERED).map(
          (h) => `${h.rule}: ${h.phrase} in "${text}"`,
        ),
      ),
    ).toEqual([]);
  });

  it("catches an id enumeration that omits a registered skin", () => {
    // The README's worst instance: a four-value LOCK_SKIN list, which a count
    // check alone would have missed entirely.
    const stale =
      "Set `LOCK_SKIN` to a skin id (`banking`, `airline`, `logistics`, `keel`) and " +
      "the deploy becomes single-tenant.";
    const hits = findIncompleteRosters(stale, skinIds);
    expect(hits).toHaveLength(1);
    expect(hits[0].missing).toEqual(["people", "commerce"]);

    const envStyle =
      "# Valid ids: banking, airline, logistics, keel. An unrecognised value THROWS.";
    expect(findIncompleteRosters(envStyle, skinIds)[0]?.missing).toEqual([
      "people",
      "commerce",
    ]);
  });

  it("leaves a deliberate subset list alone", () => {
    // No "valid/registered set" framing → not a roster claim.
    const subset =
      "Three of the six skins — **`banking`**, **`people`** and **`commerce`** — are " +
      "demo-complete against the full beat list.";
    expect(findIncompleteRosters(subset, skinIds)).toEqual([]);
  });

  it("leaves a deliberate PARTIAL glob alone", () => {
    // The second verified false positive. A glob that points at two worked
    // examples is not a claim about the valid set, and demanding exhaustiveness
    // here is what pushes a correct doc towards an exemption.
    const partial =
      "Open `src/skins/{banking,people}/suggestions.ts` for a written-out beat map.";
    expect(findIncompleteRosters(partial, skinIds)).toEqual([]);
  });

  it("catches a glob the doc frames as the whole set", () => {
    // …and the framing is what re-arms it. Both real globs in the doc set are
    // framed, one from each side, so both phrasings are pinned here.
    const before =
      "mirror the four shipped skins (`src/skins/{banking,airline,logistics,keel}/`)";
    expect(findIncompleteRosters(before, skinIds)).toMatchObject([
      { rule: "brace-glob", missing: ["people", "commerce"] },
    ]);

    const after =
      "- `src/skins/{banking,airline,logistics,keel}/skin.tsx` — four implementations.";
    expect(findIncompleteRosters(after, skinIds)).toMatchObject([
      { rule: "brace-glob", missing: ["people", "commerce"] },
    ]);
  });
});
