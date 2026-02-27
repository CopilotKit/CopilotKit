/**
 * ESLint rule: require-cpk-prefix
 *
 * Enforces that Tailwind utility classes in className attributes and
 * class-helper calls (cn, twMerge, cva, clsx) use the `cpk:` prefix.
 * Also detects the prefix in the wrong position (after variants instead of before).
 *
 * In Tailwind v4 with prefix(cpk), the prefix MUST come before all variants:
 *   cpk:dark:hover:bg-white  ✓  (generates CSS)
 *   dark:hover:cpk:bg-white  ✗  (generates NO CSS)
 *
 * Detection logic reused from scripts/add-cpk-prefix.mjs.
 */

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

function looksLikeTailwindUtility(token) {
  if (!token) return false;
  if (token.startsWith(PREFIX)) return false;
  if (token.startsWith("@")) return false;
  if (token.startsWith("data-") && !token.includes(":")) return false;

  let base = stripVariants(token);
  if (!base) return false;

  // Already prefixed somewhere after stripping known variants.
  // Uses includes() instead of startsWith() to handle unknown variants
  // that aren't in VARIANT_RE (e.g. *: child variant, &: nesting).
  if (base.includes(PREFIX)) return false;

  return isBaseUtility(base);
}

// ── Token prefixing ─────────────────────────────────────────────────────────
// In Tailwind v4 with prefix(cpk), the prefix MUST come before all variants:
//   cpk:dark:hover:bg-white  ✓
//   dark:hover:cpk:bg-white  ✗ (generates no CSS)

function prefixToken(token) {
  if (!looksLikeTailwindUtility(token)) return token;
  return PREFIX + token;
}

// Detect tokens where cpk: is placed after variant(s) instead of before them.
// e.g. dark:cpk:bg-white, hover:cpk:text-blue, dark:hover:cpk:bg-red
const WRONG_PREFIX_RE = /^((?:[a-z][-a-z0-9]*(?:\[.*?\])?:|\[.*?\]:)+)cpk:(.+)$/;

function hasWrongPrefixPosition(token) {
  return WRONG_PREFIX_RE.test(token);
}

function fixPrefixPosition(token) {
  return token.replace(WRONG_PREFIX_RE, "cpk:$1$2");
}

// ── ESLint rule ─────────────────────────────────────────────────────────────

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Enforce cpk: prefix on Tailwind utility classes in className attributes",
    },
    fixable: "code",
    schema: [],
    messages: {
      missingPrefix:
        "'{{token}}' is missing the 'cpk:' prefix. Use '{{fixed}}' instead. See eslint-rules/README.md for why.",
      wrongPrefixPosition:
        "'{{token}}' has 'cpk:' in the wrong position. The prefix must come BEFORE variants. Use '{{fixed}}' instead. See eslint-rules/README.md for why.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const CLASS_HELPERS = new Set(["cn", "twMerge", "cva", "clsx"]);
    const checked = new WeakSet();

    // ── String-literal checker ────────────────────────────────────────────

    function checkStringLiteral(node) {
      if (checked.has(node)) return;
      checked.add(node);

      const value = node.value;
      if (typeof value !== "string" || !value.trim()) return;

      // Skip single-word strings that look like JS values, not class names
      const trimmed = value.trim();
      if (!trimmed.includes(" ") && !trimmed.includes("\t")) {
        if (JS_VALUE_WORDS.has(trimmed)) return;
        if (
          !trimmed.includes("-") &&
          !trimmed.includes(":") &&
          !trimmed.includes("[")
        )
          return;
      }

      // Work with the raw source to get accurate positions
      const src = sourceCode.getText(node);
      const inner = src.slice(1, -1); // strip quotes
      const innerStart = node.range[0] + 1;

      const regex = /\S+/g;
      let match;
      while ((match = regex.exec(inner)) !== null) {
        const token = match[0];
        const rangeStart = innerStart + match.index;
        const rangeEnd = rangeStart + token.length;

        if (hasWrongPrefixPosition(token)) {
          const fixed = fixPrefixPosition(token);
          context.report({
            node,
            messageId: "wrongPrefixPosition",
            data: { token, fixed },
            fix(fixer) {
              return fixer.replaceTextRange([rangeStart, rangeEnd], fixed);
            },
          });
        } else if (looksLikeTailwindUtility(token)) {
          const fixed = prefixToken(token);
          context.report({
            node,
            messageId: "missingPrefix",
            data: { token, fixed },
            fix(fixer) {
              return fixer.replaceTextRange([rangeStart, rangeEnd], fixed);
            },
          });
        }
      }
    }

    // ── Template-literal quasi checker ────────────────────────────────────

    function checkQuasi(quasi) {
      if (checked.has(quasi)) return;
      checked.add(quasi);

      const raw = quasi.value.raw;
      if (!raw || !raw.trim()) return;

      // Find where the raw content starts in the source.
      // TemplateElement ranges include delimiters (` or ${ or }).
      const srcSlice = sourceCode.text.slice(quasi.range[0], quasi.range[1]);
      const rawIdx = srcSlice.indexOf(raw);
      const contentStart = quasi.range[0] + (rawIdx >= 0 ? rawIdx : 1);

      const regex = /\S+/g;
      let match;
      while ((match = regex.exec(raw)) !== null) {
        const token = match[0];
        const rangeStart = contentStart + match.index;
        const rangeEnd = rangeStart + token.length;

        if (hasWrongPrefixPosition(token)) {
          const fixed = fixPrefixPosition(token);
          context.report({
            node: quasi,
            messageId: "wrongPrefixPosition",
            data: { token, fixed },
            fix(fixer) {
              return fixer.replaceTextRange([rangeStart, rangeEnd], fixed);
            },
          });
        } else if (looksLikeTailwindUtility(token)) {
          const fixed = prefixToken(token);
          context.report({
            node: quasi,
            messageId: "missingPrefix",
            data: { token, fixed },
            fix(fixer) {
              return fixer.replaceTextRange([rangeStart, rangeEnd], fixed);
            },
          });
        }
      }
    }

    // ── Recursive expression walker ───────────────────────────────────────

    function checkExpression(node) {
      if (!node) return;

      switch (node.type) {
        case "Literal":
        case "StringLiteral": // babel parser
          if (typeof node.value === "string") checkStringLiteral(node);
          break;

        case "JSXExpressionContainer":
          checkExpression(node.expression);
          break;

        case "TemplateLiteral":
          for (const quasi of node.quasis) checkQuasi(quasi);
          for (const expr of node.expressions) checkExpression(expr);
          break;

        case "ConditionalExpression":
          checkExpression(node.consequent);
          checkExpression(node.alternate);
          break;

        case "LogicalExpression":
          // e.g. isActive && "bg-blue-500"
          checkExpression(node.left);
          checkExpression(node.right);
          break;

        case "CallExpression":
          if (isClassHelper(node.callee)) {
            for (const arg of node.arguments) checkExpression(arg);
          }
          break;

        case "ArrayExpression":
          for (const el of node.elements) {
            if (el) checkExpression(el);
          }
          break;

        case "ObjectExpression":
          // For cva variant objects: { variant: { default: "...", ... } }
          for (const prop of node.properties) {
            if (prop.value) checkExpression(prop.value);
          }
          break;

        case "SpreadElement":
          break;

        default:
          break;
      }
    }

    function isClassHelper(callee) {
      if (!callee) return false;
      if (callee.type === "Identifier") {
        return CLASS_HELPERS.has(callee.name);
      }
      // Handle e.g. module.cn()
      if (callee.type === "MemberExpression" && callee.property) {
        const name =
          callee.property.type === "Identifier"
            ? callee.property.name
            : callee.property.value;
        return CLASS_HELPERS.has(name);
      }
      return false;
    }

    // ── Visitors ──────────────────────────────────────────────────────────

    return {
      JSXAttribute(node) {
        if (
          node.name &&
          node.name.type === "JSXIdentifier" &&
          node.name.name === "className" &&
          node.value
        ) {
          checkExpression(node.value);
        }
      },

      CallExpression(node) {
        if (isClassHelper(node.callee)) {
          for (const arg of node.arguments) {
            checkExpression(arg);
          }
        }
      },
    };
  },
};

export default rule;
