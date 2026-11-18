import { createHash } from "node:crypto";
import type { VerifiedSnapshot } from "../skill-registry/snapshot";

export const sha = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export const usdTotal = `function run(input) {
  const total = input.deals.reduce((sum, deal) => sum + deal.amount * input.rates[deal.currency], 0);
  return { totalUsd: Math.round(total * 100) / 100 };
}`;

function file(path: string, text: string) {
  return { path, size: text.length, sha256: sha(text), text };
}

export function scriptedSnapshot(
  source = usdTotal,
  entry: Record<string, unknown> = {},
): VerifiedSnapshot {
  const manifest = JSON.stringify({
    scripts: [
      {
        path: "scripts/usd-total.js",
        kind: "action",
        language: "javascript",
        entrypoint: "run",
        contractVersion: 1,
        version: 1,
        sha256: sha(usdTotal),
        input: "The deals tool result.",
        ...entry,
      },
    ],
  });
  return {
    revision: "r1",
    etag: "e1",
    skills: [
      {
        name: "pipeline-total",
        description: "Total open deals in USD.",
        files: [
          file("SKILL.md", "# Pipeline total"),
          file("scripts/usd-total.js", source),
          file("scripts/manifest.json", manifest),
        ],
      },
    ],
  };
}
