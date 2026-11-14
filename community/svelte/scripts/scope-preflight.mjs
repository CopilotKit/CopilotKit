/** Scopes Tailwind's base layer to prevent CopilotKit styles leaking into the host. */
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "postcss";

const scope = "[data-copilotkit]";
const file = process.argv[2];

if (!file) {
  throw new Error("Usage: node scripts/scope-preflight.mjs <css-file>");
}

function scopeSelector(selector) {
  const trimmed = selector.trim();

  if (
    trimmed.includes("[data-copilotkit]") ||
    trimmed.includes("[data-copilot-sidebar]") ||
    trimmed.includes("[data-popup-chat]") ||
    trimmed.includes("[data-sidebar-chat]")
  ) {
    return [trimmed];
  }

  if (trimmed === "body" || trimmed === "::backdrop") return [];
  if (trimmed === "html" || trimmed === ":host") return [scope];
  if (trimmed === "*") return [scope, `${scope} *`];
  if (trimmed.startsWith(":")) return [`${scope} ${trimmed}`];

  return [`${scope} ${trimmed}`, `${trimmed}${scope}`];
}

const root = parse(readFileSync(file, "utf8"));

root.walkAtRules("layer", (layer) => {
  if (layer.params !== "base") return;

  layer.walkRules((rule) => {
    rule.selectors = rule.selectors.flatMap(scopeSelector);
    if (rule.selectors.length === 0) rule.remove();
  });
});

writeFileSync(file, root.toString());
