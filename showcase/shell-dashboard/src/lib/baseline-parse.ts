/* baseline-parse.ts — Parse Notion cell values into baseline data */

import type { BaselineStatus, BaselineTag } from "./baseline-types";

/* ------------------------------------------------------------------ */
/*  Tag pattern mapping                                                */
/* ------------------------------------------------------------------ */

const TAG_MAP: Record<string, BaselineTag> = {
  ALL: "all",
  CPK: "cpk",
  "AG-UI": "agui",
  INT: "int",
  DEMO: "demo",
  DOCS: "docs",
  TEST: "tests",
  TESTS: "tests",
};

/* ------------------------------------------------------------------ */
/*  parseNotionCell                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedCell {
  status: BaselineStatus;
  tags: BaselineTag[];
}

/**
 * Parses a raw Notion cell string into a status + tag set.
 *
 * Emoji prefix determines status:
 *   ✅  → works
 *   ❌  → impossible
 *   ❓  → unknown
 *   🛠️/🛠 → possible (defaults to ["all"] if no tags found)
 *   empty → unknown
 *   free text → unknown (console.warn)
 */
export function parseNotionCell(raw: string): ParsedCell {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { status: "unknown", tags: [] };
  }

  if (trimmed.startsWith("✅")) {
    return { status: "works", tags: [] };
  }

  if (trimmed.startsWith("❌")) {
    const tags = extractTags(trimmed);
    return { status: "impossible", tags };
  }

  if (trimmed.startsWith("❓")) {
    return { status: "unknown", tags: [] };
  }

  // 🛠️ (U+1F6E0 U+FE0F) or 🛠 (U+1F6E0 without variation selector)
  if (trimmed.startsWith("🛠️") || trimmed.startsWith("🛠")) {
    const tags = extractTags(trimmed);
    return { status: "possible", tags: tags.length === 0 ? ["all"] : tags };
  }

  // Free text — no recognized emoji prefix
  console.warn(`Unrecognized Notion cell value: ${JSON.stringify(raw)}`);
  return { status: "unknown", tags: [] };
}

/* ------------------------------------------------------------------ */
/*  extractTags                                                        */
/* ------------------------------------------------------------------ */

function extractTags(text: string): BaselineTag[] {
  const tags: BaselineTag[] = [];
  const pattern = /\[([A-Z-]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const mapped = TAG_MAP[match[1]];
    if (mapped && !tags.includes(mapped)) {
      tags.push(mapped);
    }
  }

  return tags;
}

/* ------------------------------------------------------------------ */
/*  toSlug                                                             */
/* ------------------------------------------------------------------ */

const SLUG_OVERRIDES: Record<string, string> = {
  "MAF - .Net": "maf-dotnet",
  "MAF - Python": "maf-python",
};

/**
 * Convert a display name to a kebab-case slug.
 *
 * Special overrides for known names, otherwise:
 * - Replace em dashes (—) with hyphens
 * - Strip parens, plus, ampersand, dots
 * - Collapse spaces/hyphens
 * - Lowercase
 */
export function toSlug(name: string): string {
  if (SLUG_OVERRIDES[name]) {
    return SLUG_OVERRIDES[name];
  }

  return name
    .replace(/—/g, "-") // em dash → hyphen
    .replace(/[()+'&.]/g, "") // strip parens, plus, ampersand, dots, apostrophes
    .replace(/[\s-]+/g, "-") // collapse whitespace & hyphens
    .replace(/^-|-$/g, "") // trim leading/trailing hyphens
    .toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  SeedEntry                                                          */
/* ------------------------------------------------------------------ */

export interface SeedEntry {
  partnerSlug: string;
  featureSlug: string;
  status: BaselineStatus;
  tags: BaselineTag[];
}

/* ------------------------------------------------------------------ */
/*  parseNotionData                                                    */
/* ------------------------------------------------------------------ */

/**
 * Iterates rows x partner columns, parsing each Notion cell.
 *
 * @param rows - Array of objects, each with a "Feature / Capability" key
 *               and one key per partner name containing the raw cell string.
 * @param partnerNames - Ordered list of partner column names.
 * @returns Flat array of SeedEntry objects.
 */
export function parseNotionData(
  rows: Record<string, string>[],
  partnerNames: string[],
): SeedEntry[] {
  const entries: SeedEntry[] = [];

  for (const row of rows) {
    const featureName = row["Feature / Capability"];
    if (!featureName) continue;

    const featureSlug = toSlug(featureName);

    for (const partner of partnerNames) {
      const cellValue = row[partner] ?? "";
      const parsed = parseNotionCell(cellValue);
      entries.push({
        partnerSlug: toSlug(partner),
        featureSlug,
        status: parsed.status,
        tags: parsed.tags,
      });
    }
  }

  return entries;
}
