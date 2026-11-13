/** Manual audit only; importing this entrypoint never starts collection. */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { collectAudit } from "./compatibility-audit/collect";
import type { AuditResult } from "./compatibility-audit/collect";

function asOfUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    throw new Error("--as-of must be an ISO UTC timestamp.");
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw new Error("--as-of must be a valid ISO UTC timestamp.");
  return value;
}

export async function runAudit(args: string[]): Promise<AuditResult> {
  const { values, tokens } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      out: { type: "string" },
      "as-of": { type: "string" },
      "write-snapshot": { type: "boolean" },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      throw new Error(`Option --${token.name} must be supplied once.`);
    seen.add(token.name);
  }
  if (!values.out || !isAbsolute(values.out))
    throw new Error("--out must be an absolute report file path.");
  const asOf = asOfUtc(values["as-of"] ?? new Date().toISOString());
  return collectAudit({
    out: values.out,
    asOf,
    writeSnapshot: values["write-snapshot"],
  });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const result = await runAudit(args);
    console.log(
      `Compatibility audit: ${result.snapshot.rows.length} variants, ${result.packages.length} packages, as of ${result.report.asOf}.`,
    );
    return 0;
  } catch (error) {
    console.error(
      `Cannot audit compatibility: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
