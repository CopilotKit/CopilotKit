import { checkPattern } from "@ui-sdk/core/testing";
import type { Finding } from "./index";
import { warnFindings } from "./index";

/** The beta checker throws prose, not structured violations. Only its documented
 * finding error is baselined; crashes and unsupported environments still fail. */
export async function collectPatternFindings(
  root: Element,
  pattern: "tabs" | "dialog",
): Promise<Finding[]> {
  const ids = new Map<string, string>();
  const collect = () => {
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [
        "id",
        "aria-controls",
        "aria-labelledby",
        "aria-describedby",
        "aria-owns",
        "aria-activedescendant",
      ]) {
        for (const id of (el.getAttribute(attr) ?? "")
          .split(/\s+/)
          .filter(Boolean)) {
          if (!ids.has(id)) ids.set(id, `<id:${ids.size + 1}>`);
        }
      }
    }
  };
  collect();
  let findings: Finding[] = [];
  try {
    await checkPattern(root, pattern);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/^checkPattern found \d+ problems? with the /.test(error.message)
    )
      throw error;
    collect();
    let message = error.message;
    for (const [id, stable] of [...ids].sort(
      (a, b) => b[0].length - a[0].length,
    ))
      message = message
        .replaceAll(`#${id}`, `#${stable}`)
        .replaceAll(`"${id}"`, `"${stable}"`);
    findings = message
      .split("\n")
      .filter((x) => x.startsWith("- "))
      .map((detail) => ({
        rule: pattern,
        target: ":scope",
        detail: detail.slice(2),
      }));
  }

  return findings;
}

/** Warning-only entry point; unexpected checker errors remain harness failures. */
export async function expectPattern(
  root: Element,
  pattern: "tabs" | "dialog",
): Promise<Finding[]> {
  const findings = await collectPatternFindings(root, pattern);
  warnFindings(`pattern/${pattern}`, findings);
  return findings;
}
