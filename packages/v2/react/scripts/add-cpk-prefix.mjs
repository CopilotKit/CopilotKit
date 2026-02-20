/**
 * Adds `cpk:` prefix to Tailwind utility classes in CopilotKit component files.
 * Run: node scripts/add-cpk-prefix.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, "..");
const PREFIX = "cpk:";

// ── Tailwind utility detection ──────────────────────────────────────────────

const SINGLE_WORD_UTILITIES = new Set([
  "absolute","antialiased","block","border","capitalize","collapse",
  "container","contents","fixed","flex","grid","grow","hidden","inline",
  "inline-block","inline-flex","inline-grid","invisible","isolate","italic",
  "lowercase","ordinal","outline","overflow","overline","relative","resize",
  "ring","rounded","shadow","shrink","static","sticky","table","truncate",
  "underline","uppercase","visible","prose",
]);

// Single-word strings that are likely JS values, NOT className strings
const JS_VALUE_WORDS = new Set([
  "absolute","static","relative","fixed","sticky",
  "contents","none","auto","inherit","initial","unset","revert",
  "block","inline","flex","grid","hidden",
  "smooth","instant","nearest",
  "button","submit","reset",
  "input","transcribe","processing",
  "recording","idle",
  "text","password","email","number","tel","url","search",
  "top","bottom","left","right","start","end",
  "compact","expanded",
  "before","after",
  "open","closed",
  "default","destructive","outline","secondary","ghost","link",
]);

function isClassString(str) {
  if (!str || str.length === 0) return false;

  const tokens = str.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  // Single-word strings: almost always JS values, not className strings
  if (tokens.length === 1) {
    const t = tokens[0];
    if (JS_VALUE_WORDS.has(t)) return false;
    if (!t.includes("-") && !t.includes(":") && !t.includes("[")) return false;
  }

  let twCount = 0;
  for (const t of tokens) {
    if (looksLikeTailwindUtility(t)) twCount++;
  }

  return twCount >= 1 && (twCount / tokens.length) >= 0.4;
}

function looksLikeTailwindUtility(token) {
  if (!token) return false;
  if (token.startsWith(PREFIX)) return false;
  if (token.startsWith("@")) return false;
  if (token.startsWith("data-") && !token.includes(":")) return false;

  let base = stripVariants(token);
  if (!base) return false;

  return isBaseUtility(base);
}

const VARIANT_RE = /^(?:dark|hover|focus|focus-visible|focus-within|active|disabled|visited|checked|required|invalid|first|last|odd|even|only|empty|enabled|read-only|placeholder-shown|autofill|default|indeterminate|open|closed|group-hover|group-focus|peer-hover|peer-focus|peer-checked|placeholder|before|after|selection|marker|first-line|first-letter|file|sm|md|lg|xl|2xl|portrait|landscape|motion-safe|motion-reduce|contrast-more|contrast-less|forced-colors|print|ltr|rtl|aria-invalid|aria-checked|aria-disabled|aria-expanded|aria-hidden|aria-pressed|aria-readonly|aria-required|aria-selected|has-\[.+?\]|not-\[.+?\]|group-data-\[.+?\]|supports-\[.+?\]|min-\[.+?\]|max-\[.+?\]|data-\[.+?\]|aria-\[.+?\]|\[.+?\]):/;

function stripVariants(token) {
  let base = token;
  let iterations = 0;
  while (VARIANT_RE.test(base) && iterations < 20) {
    base = base.replace(VARIANT_RE, "");
    iterations++;
  }
  return base;
}

function isBaseUtility(base) {
  if (!base) return false;

  let b = base;
  if (b.startsWith("-") || b.startsWith("!")) b = b.slice(1);

  // Strip opacity modifier: bg-primary/90 → bg-primary
  const slashIdx = b.indexOf("/");
  let bNoOpacity = b;
  if (slashIdx > 0 && !b.includes("[")) {
    bNoOpacity = b.slice(0, slashIdx);
  }

  if (SINGLE_WORD_UTILITIES.has(bNoOpacity)) return true;

  const prefixes = [
    "bg-","text-","font-","p-","px-","py-","pt-","pb-","pl-","pr-",
    "m-","mx-","my-","mt-","mb-","ml-","mr-",
    "w-","h-","min-w-","max-w-","min-h-","max-h-","size-",
    "flex-","grid-","col-","row-","auto-cols-","auto-rows-",
    "gap-","gap-x-","gap-y-","space-x-","space-y-",
    "items-","justify-","self-","content-","place-",
    "border-","rounded-","ring-","outline-","divide-","shadow-",
    "z-","inset-","inset-x-","inset-y-","top-","right-","bottom-","left-","start-","end-",
    "leading-","tracking-","whitespace-","break-","indent-","align-",
    "decoration-","underline-offset-",
    "opacity-","overflow-","object-","float-","clear-",
    "transition-","duration-","ease-","delay-","animate-",
    "scale-","rotate-","translate-","skew-","origin-",
    "cursor-","pointer-events-","select-","touch-","scroll-","snap-",
    "accent-","caret-","will-change-","contain-",
    "fill-","stroke-","aspect-","columns-",
    "from-","via-","to-","gradient-",
    "backdrop-","blur-","brightness-","contrast-","drop-shadow-",
    "grayscale-","hue-rotate-","invert-","saturate-","sepia-",
    "ring-offset-",
    "list-","order-","basis-","grow-","shrink-",
    "sr-","appearance-",
    "transform-",
  ];

  for (const p of prefixes) {
    if (bNoOpacity.startsWith(p)) return true;
  }

  if (b.startsWith("[") && b.endsWith("]")) return true;
  if (/\[.+\]/.test(b)) return true;
  if (/\(/.test(b) && /^[a-z]/.test(b)) return true;

  if (/^(line-through|no-underline|normal-case|not-italic|subpixel-antialiased|table-auto|table-fixed|border-collapse|border-separate|sr-only|not-sr-only|break-words|break-all|break-normal|overflow-auto|overflow-hidden|overflow-visible|overflow-scroll|overflow-x-auto|overflow-x-hidden|overflow-y-auto|overflow-y-hidden|overflow-y-scroll|inline-block|inline-flex|inline-grid|flow-root|list-item|outline-hidden|outline-none|bg-clip-padding|bg-gradient-to-t|bg-gradient-to-b|bg-gradient-to-l|bg-gradient-to-r|not-prose|transform-gpu)$/.test(bNoOpacity))
    return true;

  return false;
}

// ── Token prefixing ─────────────────────────────────────────────────────────

function prefixToken(token) {
  if (!looksLikeTailwindUtility(token)) return token;

  let idx = 0;
  const len = token.length;

  while (idx < len) {
    const rest = token.slice(idx);

    // Arbitrary variant: [...]:
    if (rest[0] === "[") {
      let depth = 0;
      let k = 0;
      while (k < rest.length) {
        if (rest[k] === "[") depth++;
        else if (rest[k] === "]") { depth--; if (depth === 0) break; }
        k++;
      }
      if (k + 1 < rest.length && rest[k + 1] === ":") {
        idx += k + 2;
        continue;
      }
      break;
    }

    // Named variant: word (possibly with hyphens/brackets) then `:`
    const m = rest.match(/^([a-z*][a-z0-9-]*(?:\[.*?\])?):/);
    if (m) {
      idx += m[0].length;
      continue;
    }

    break;
  }

  if (idx > 0) {
    return token.slice(0, idx) + PREFIX + token.slice(idx);
  }
  return PREFIX + token;
}

function prefixClassString(str) {
  return str.replace(/\S+/g, (tok) => prefixToken(tok));
}

// ── File processing ─────────────────────────────────────────────────────────

function processFileContent(content) {
  const len = content.length;
  const result = [];
  let i = 0;

  while (i < len) {
    // ── Skip single-line comments: // ...
    if (content[i] === "/" && i + 1 < len && content[i + 1] === "/") {
      const nlIdx = content.indexOf("\n", i);
      if (nlIdx === -1) {
        // Comment extends to end of file
        result.push(content.slice(i));
        break;
      }
      result.push(content.slice(i, nlIdx));
      i = nlIdx;
      continue;
    }

    // ── Skip multi-line comments: /* ... */
    if (content[i] === "/" && i + 1 < len && content[i + 1] === "*") {
      const endIdx = content.indexOf("*/", i + 2);
      if (endIdx === -1) {
        result.push(content.slice(i));
        break;
      }
      result.push(content.slice(i, endIdx + 2));
      i = endIdx + 2;
      continue;
    }

    const ch = content[i];

    // ── Handle single/double quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = "";
      let j = i + 1;
      while (j < len && content[j] !== quote) {
        if (content[j] === "\\") {
          str += content[j] + (content[j + 1] ?? "");
          j += 2;
        } else {
          str += content[j];
          j++;
        }
      }

      if (isClassString(str)) {
        result.push(quote + prefixClassString(str) + quote);
      } else {
        result.push(quote + str + quote);
      }
      i = j + 1;
      continue;
    }

    // ── Handle backtick template literals
    if (ch === "`") {
      let tpl = "`";
      let j = i + 1;

      while (j < len && content[j] !== "`") {
        if (content[j] === "\\" && j + 1 < len) {
          tpl += content[j] + content[j + 1];
          j += 2;
        } else if (content[j] === "$" && j + 1 < len && content[j + 1] === "{") {
          tpl += "${";
          j += 2;
          let depth = 1;
          while (j < len && depth > 0) {
            if (content[j] === "{") depth++;
            else if (content[j] === "}") {
              depth--;
              if (depth === 0) break;
            }
            // Handle strings inside template expressions
            if (depth > 0 && (content[j] === '"' || content[j] === "'")) {
              const q = content[j];
              tpl += q;
              j++;
              while (j < len && content[j] !== q) {
                if (content[j] === "\\") {
                  tpl += content[j] + (content[j + 1] ?? "");
                  j += 2;
                } else {
                  tpl += content[j];
                  j++;
                }
              }
              if (j < len) {
                tpl += content[j]; // closing quote
                j++;
              }
              continue;
            }
            if (depth > 0 && content[j] === "`") {
              tpl += "`";
              j++;
              while (j < len && content[j] !== "`") {
                tpl += content[j];
                j++;
              }
              if (j < len) {
                tpl += "`";
                j++;
              }
              continue;
            }
            tpl += content[j];
            j++;
          }
          tpl += "}";
          j++; // skip closing }
        } else {
          tpl += content[j];
          j++;
        }
      }

      tpl += "`";
      result.push(tpl);
      i = j + 1;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join("");
}

// ── Main ────────────────────────────────────────────────────────────────────

const files = [
  "src/components/chat/CopilotChatView.tsx",
  "src/components/chat/CopilotChatInput.tsx",
  "src/components/chat/CopilotChatAssistantMessage.tsx",
  "src/components/chat/CopilotChatUserMessage.tsx",
  "src/components/chat/CopilotChatMessageView.tsx",
  "src/components/chat/CopilotChatReasoningMessage.tsx",
  "src/components/chat/CopilotChatAudioRecorder.tsx",
  "src/components/chat/CopilotChatSuggestionView.tsx",
  "src/components/chat/CopilotChatSuggestionPill.tsx",
  "src/components/chat/CopilotChatToggleButton.tsx",
  "src/components/chat/CopilotChatToolCallsView.tsx",
  "src/components/chat/CopilotModalHeader.tsx",
  "src/components/chat/CopilotPopupView.tsx",
  "src/components/chat/CopilotSidebarView.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/dropdown-menu.tsx",
  "src/components/ui/tooltip.tsx",
  "src/components/WildcardToolCallRender.tsx",
];

let totalChanged = 0;

for (const file of files) {
  const fullPath = resolve(BASE, file);
  const original = readFileSync(fullPath, "utf8");
  const processed = processFileContent(original);

  if (original !== processed) {
    writeFileSync(fullPath, processed);
    totalChanged++;
    console.log(`✓ ${file}`);
  } else {
    console.log(`- ${file} (no changes)`);
  }
}

console.log(`\nDone. ${totalChanged} files modified.`);
