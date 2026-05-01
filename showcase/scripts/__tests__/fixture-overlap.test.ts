import { describe, it, expect } from "vitest";
import path from "path";
import { readdirSync, readFileSync, existsSync } from "fs";
import { findOverlaps, formatOverlaps } from "../validate-fixture-overlap";
import type { Allowlist, Fixture } from "../validate-fixture-overlap";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AIMOCK_DIR = path.join(REPO_ROOT, "showcase", "aimock");

// Common chat fragments that, if used as a fixture's userMessage, will match
// virtually any unrelated test prompt. Keep this list curated — adding tokens
// to make a collision pass is the wrong fix; the right fix is to rewrite the
// fixture's userMessage to be more specific.
const NOISE = [
  "hi",
  "hello",
  "help",
  "the",
  "say",
  "ok",
  "okay",
  "please",
  "thanks",
  "architecture",
  "chat",
  "test",
  "yes",
  "no",
];

type FixtureFile = {
  fixtures?: Array<{
    match?: { userMessage?: string };
  }>;
};

type AllowlistFile = {
  entries?: Allowlist;
};

function loadFixtures(filePath: string, relSource: string): Fixture[] {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as FixtureFile;
  const out: Fixture[] = [];
  for (const [i, fx] of (parsed.fixtures ?? []).entries()) {
    const userMessage = fx.match?.userMessage;
    if (typeof userMessage === "string" && userMessage.length > 0) {
      out.push({ source: relSource, index: i, userMessage });
    }
  }
  return out;
}

function loadAllowlist(filePath: string): Allowlist {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as AllowlistFile;
  return parsed.entries ?? [];
}

describe("aimock fixture overlap", () => {
  const allFiles = readdirSync(AIMOCK_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !f.endsWith(".allowlist.json"))
    .map((f) => ({
      relative: path.posix.join("showcase", "aimock", f),
      absolute: path.join(AIMOCK_DIR, f),
    }));

  it("loads at least one fixture file", () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  it("every userMessage is substring-disjoint or allowlisted, and none is a noise token", () => {
    const fixtures: Fixture[] = [];
    for (const file of allFiles) {
      fixtures.push(...loadFixtures(file.absolute, file.relative));
    }
    // Allowlist is per-file (d5-all.allowlist.json) but applies across the
    // unioned fixture set — substring relationships span files in practice
    // (d5-all + feature-parity).
    const allowlistPath = path.join(AIMOCK_DIR, "d5-all.allowlist.json");
    const allowlist = loadAllowlist(allowlistPath);

    const overlaps = findOverlaps(fixtures, allowlist, NOISE);
    if (overlaps.length > 0) {
      throw new Error(
        `${overlaps.length} fixture overlap(s) found:\n${formatOverlaps(overlaps)}\n\n` +
          `Fix: rewrite the offending fixture's userMessage to be more specific, ` +
          `or add an entry to d5-all.allowlist.json with a reason if the ` +
          `relationship is intentional.`,
      );
    }
    expect(overlaps).toEqual([]);
  });
});
