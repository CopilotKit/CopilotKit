/**
 * Post-processes compiled Tailwind CSS to scope all @layer base rules
 * under [data-copilotkit], preventing CopilotKit styles from leaking
 * into the host application.
 *
 * Run after `tailwindcss` CLI: node scripts/scope-preflight.mjs <file>
 * Also imported by the React Storybook so dev CSS matches the published build.
 */

import { readFileSync, writeFileSync } from "fs";
import { pathToFileURL } from "url";
import postcss from "postcss";

const SCOPE = "[data-copilotkit]";

/** Selectors that are already scoped and should be left alone. */
function isAlreadyScoped(selector) {
  return (
    selector.includes("[data-copilot") || selector.includes("[data-sidebar")
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

  // Pseudo-elements (::) and vendor pseudo-classes (:-) → descendant only
  // These can't be combined with an attribute selector suffix
  if (sel.startsWith(":")) {
    return `${SCOPE} ${sel}`;
  }

  // Element / attribute selectors → descendant AND self-matching
  // e.g. button → [data-copilotkit] button, button[data-copilotkit]
  // This ensures <button data-copilotkit> also receives the preflight reset
  return `${SCOPE} ${sel}, ${sel}${SCOPE}`;
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

/** Scope every rule inside `@layer base` under [data-copilotkit]. */
export function scopePreflight(css) {
  const root = postcss.parse(css);

  root.walkAtRules("layer", (layer) => {
    if (layer.params !== "base") return;
    scopeChildren(layer);
  });

  return root.toString();
}

// --- Main ---
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/scope-preflight.mjs <css-file>");
    process.exit(1);
  }
  writeFileSync(file, scopePreflight(readFileSync(file, "utf8")));
}
