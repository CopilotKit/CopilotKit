import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyKnown, checkDOM, collectAxeFindings } from "./index";
import { collectPatternFindings } from "./pattern";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function audit(
  framework: string,
  fixture: string,
  clicks: ReadonlySet<Element>,
  host?: Element,
  pattern?: "tabs" | "dialog" | null,
) {
  const start = performance.now();
  const root = document.body;
  const axe = await collectAxeFindings(root);
  const dom = checkDOM(root, clicks, host ? [host] : []);
  const patternFindings = pattern
    ? await collectPatternFindings(root, pattern)
    : [];
  const file = resolve(base, "known-violations", framework + ".json");
  const known = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const signatures = [
    ...axe.map((x) => "axe:" + JSON.stringify(x)),
    ...dom.map((x) => "dom:" + JSON.stringify(x)),
    ...patternFindings.map((x) => "pattern:" + JSON.stringify(x)),
  ].sort();
  const missingBaseline = !(fixture in known);
  const classification = classifyKnown(signatures, known[fixture] ?? []);
  const warnings = {
    known: classification.known.length,
    new: classification.new.length,
    missingBaseline,
  };
  const result = {
    axe,
    dom,
    pattern: patternFindings,
    classification,
    warnings,
    milliseconds: Math.round(performance.now() - start),
  };
  if (signatures.length || missingBaseline) {
    const rules = [
      ...new Set(
        signatures.map(
          (x) =>
            `${x.slice(0, x.indexOf(":"))}/${JSON.parse(x.slice(x.indexOf(":") + 1)).rule}`,
        ),
      ),
    ];
    process.stderr.write(
      `[a11y warning] ${framework}/${fixture}: ${warnings.known} known, ${warnings.new} new${missingBaseline ? "; no reviewed baseline" : ""}; ${rules.join(", ") || "no findings"}\n`,
    );
    for (const finding of classification.new)
      process.stderr.write(`  new: ${finding}\n`);
  }
  if (process.env.A11Y_UPDATE_BASELINE === "1") {
    if (process.env.CI) throw new Error("Baseline updates are disabled in CI");
    known[fixture] = signatures;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(known, null, 2) + "\n");
  }
  if (process.env.A11Y_REPORT_DIR) {
    const out = resolve(
      process.env.A11Y_REPORT_DIR,
      framework + "--" + fixture + ".json",
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  }
  return result;
}
