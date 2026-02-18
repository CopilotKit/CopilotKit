/**
 * Post-processes compiled Tailwind CSS to scope all @layer base rules
 * under [data-copilotkit], preventing CopilotKit styles from leaking
 * into the host application.
 *
 * Run after `tailwindcss` CLI: node scripts/scope-preflight.mjs <file>
 */

import { readFileSync, writeFileSync } from "fs";
import postcss from "postcss";

const SCOPE = "[data-copilotkit]";
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/scope-preflight.mjs <css-file>");
  process.exit(1);
}

/** Selectors that are already scoped and should be left alone. */
function isAlreadyScoped(selector) {
  return (
    selector.includes("[data-copilot") ||
    selector.includes("[data-sidebar")
  );
}

/** Rewrite a single selector to be scoped under [data-copilotkit]. */
function scopeSelector(sel) {
  sel = sel.trim();

  // Already scoped — keep as-is
  if (isAlreadyScoped(sel)) return sel;

  // html, :host → [data-copilotkit]
  if (sel === "html" || sel === ":host" || sel === "html,:host") {
    return SCOPE;
  }

  // body → null (remove)
  if (sel === "body") return null;

  // ::backdrop → null (cannot be scoped to a container)
  if (sel === "::backdrop") return null;

  // Bare universal selector → scope to container + descendants
  if (sel === "*") return `${SCOPE}, ${SCOPE} *`;

  // Pseudo-elements that start with :: (e.g. ::file-selector-button,
  // ::placeholder, ::-webkit-*) → scope as descendant
  // Pseudo-classes starting with : (e.g. :-moz-focusring) → scope as descendant
  return `${SCOPE} ${sel}`;
}

function scopeRule(rule) {
  const newSelectors = [];

  for (const sel of rule.selectors) {
    const scoped = scopeSelector(sel);
    if (scoped !== null) {
      // scopeSelector may return comma-separated selectors (for *)
      if (typeof scoped === "string" && scoped.includes(", ")) {
        newSelectors.push(...scoped.split(", "));
      } else if (scoped) {
        newSelectors.push(scoped);
      }
    }
  }

  if (newSelectors.length === 0) {
    rule.remove();
  } else {
    rule.selectors = newSelectors;
  }
}

/** Recursively scope all rules within a node (handles @supports, @media, etc.) */
function scopeChildren(node) {
  node.walk((child) => {
    if (child.type === "rule") {
      scopeRule(child);
    }
    // @supports / @media blocks are walked automatically
  });
}

// --- Main ---
const css = readFileSync(file, "utf8");
const root = postcss.parse(css);

root.walkAtRules("layer", (layer) => {
  if (layer.params !== "base") return;
  scopeChildren(layer);
});

writeFileSync(file, root.toString());
