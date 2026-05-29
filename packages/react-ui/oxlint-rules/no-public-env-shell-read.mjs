/**
 * Oxlint rule: no-public-env-shell-read
 *
 * Bans direct READS of a specific, enumerated set of `process.env.NEXT_PUBLIC_*`
 * URL/analytics keys (see `BANNED_KEYS` below) in showcase shell client/server
 * code. Those values are now served at runtime via `getRuntimeConfig()` (see
 * workstream B / Option-B migration); a stray `process.env.NEXT_PUBLIC_<key>`
 * read would silently re-freeze the value at build time and regress the
 * migration.
 *
 * IMPORTANT: this rule does NOT ban every `NEXT_PUBLIC_*` read — only the
 * explicit banned-key set. Build-stamp keys (NEXT_PUBLIC_COMMIT_SHA,
 * NEXT_PUBLIC_BRANCH) and the local-dev computed key
 * (NEXT_PUBLIC_LOCAL_BACKENDS) are intentionally NOT banned.
 *
 * Allowed (intentionally NOT in the banned set):
 *   - `NEXT_PUBLIC_COMMIT_SHA`   — build-stamped artifact identifier
 *   - `NEXT_PUBLIC_BRANCH`       — build-stamped artifact identifier
 *   - `NEXT_PUBLIC_LOCAL_BACKENDS` — local-dev only, computed from
 *     `shared/local-ports.json` at build time (not a real env var)
 *
 * Forms detected as READS (each will be flagged):
 *   - dotted member:           process.env.NEXT_PUBLIC_SHELL_URL
 *   - string-bracket member:   process.env["NEXT_PUBLIC_SHELL_URL"]
 *   - no-expression template:  process.env[`NEXT_PUBLIC_SHELL_URL`]
 *   - optional chaining:       process.env?.NEXT_PUBLIC_SHELL_URL
 *                              process.env?.["NEXT_PUBLIC_SHELL_URL"]
 *   - destructuring read:      const { NEXT_PUBLIC_SHELL_URL } = process.env
 *                              const { NEXT_PUBLIC_SHELL_URL: aliased } = process.env
 *
 * Forms intentionally NOT flagged (writes/deletes are not reads):
 *   - assignment LHS:          process.env.NEXT_PUBLIC_X = "..."
 *   - delete:                  delete process.env.NEXT_PUBLIC_X
 *
 * Out of scope (would require scope-tracking; documented as a known gap):
 *   - aliasing:                const e = process.env; e.NEXT_PUBLIC_X
 *
 * Scope is enforced via `overrides[].files` in `.oxlintrc.json` (shell
 * source trees only; `.mdx` content, runtime-config implementation files,
 * and tests are excluded by a follow-up override that turns this rule
 * back off).
 *
 * Note: plan-B's original spec called for oxlint's `eslint/no-restricted-syntax`
 * with an AST selector regex. oxlint 1.x does not implement that rule
 * (only `no-restricted-globals` / `no-restricted-imports`), so we
 * implement the equivalent guard as a focused custom rule in the existing
 * copilotkit oxlint plugin instead.
 */

const BANNED_KEYS = new Set([
  "NEXT_PUBLIC_POCKETBASE_URL",
  "NEXT_PUBLIC_SHELL_URL",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_OPS_BASE_URL",
  "NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_SCARF_PIXEL_ID",
  "NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID",
  "NEXT_PUBLIC_REB2B_KEY",
  "NEXT_PUBLIC_REO_KEY",
]);

/**
 * True iff `node` is the `process.env` member expression (covers both
 * `process.env` and `process?.env`). All read forms hang off this anchor.
 */
function isProcessEnv(node) {
  if (!node || node.type !== "MemberExpression") return false;
  if (node.computed) return false;
  if (!node.object || node.object.type !== "Identifier") return false;
  if (node.object.name !== "process") return false;
  if (!node.property || node.property.type !== "Identifier") return false;
  return node.property.name === "env";
}

/**
 * Given a `node.property` from a MemberExpression read off `process.env`,
 * return the static key name if we can determine one — or null if the key
 * is dynamic (and therefore out of scope for a static lint).
 *
 * Handled key forms:
 *   - Identifier (dotted: process.env.FOO)
 *   - Literal string (bracket: process.env["FOO"])
 *   - TemplateLiteral with no expressions (process.env[`FOO`])
 */
function staticKeyName(property, computed) {
  if (!property) return null;
  if (!computed && property.type === "Identifier") {
    return property.name;
  }
  if (computed && property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  if (
    computed &&
    property.type === "TemplateLiteral" &&
    Array.isArray(property.expressions) &&
    property.expressions.length === 0 &&
    Array.isArray(property.quasis) &&
    property.quasis.length === 1
  ) {
    const cooked = property.quasis[0]?.value?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow shell-side reads of a banned set of NEXT_PUBLIC_* URL/analytics keys (process.env.<key>, process.env['<key>'], destructuring, optional chaining) — use getRuntimeConfig() instead",
    },
    schema: [],
    messages: {
      forbiddenRead:
        "Do not read process.env.NEXT_PUBLIC_* directly in shell code. Use getRuntimeConfig() from @/lib/runtime-config.client (client) or @/lib/runtime-config (server). See workstream B.",
    },
  },

  create(context) {
    return {
      // Member-expression reads: dotted, bracket-string, bracket-template,
      // and optional-chained equivalents. We skip writes (assignment LHS)
      // and `delete` targets — those are not reads of the value.
      MemberExpression(node) {
        if (!isProcessEnv(node.object)) return;

        // Write target: `process.env.X = ...`. The MemberExpression is the
        // LHS of an AssignmentExpression — not a read.
        const parent = node.parent;
        if (parent && parent.type === "AssignmentExpression" && parent.left === node) {
          return;
        }
        // `delete process.env.X` — not a read either.
        if (parent && parent.type === "UnaryExpression" && parent.operator === "delete") {
          return;
        }
        // `update` operators (++/--): also a write, but extremely unlikely
        // on a string env var. Defensive bail anyway.
        if (parent && parent.type === "UpdateExpression") {
          return;
        }

        const keyName = staticKeyName(node.property, node.computed);
        if (!keyName) return;
        if (!BANNED_KEYS.has(keyName)) return;

        context.report({ node, messageId: "forbiddenRead" });
      },

      // Destructuring reads: `const { NEXT_PUBLIC_X } = process.env` and the
      // aliased form `const { NEXT_PUBLIC_X: y } = process.env`. We catch
      // this at the VariableDeclarator level so we can confirm the init is
      // exactly `process.env` (not some other object with same-named props).
      //
      // Note: this does NOT cover the aliasing case
      // `const e = process.env; e.NEXT_PUBLIC_X` — that requires scope
      // tracking and is intentionally out of scope; see file header.
      VariableDeclarator(node) {
        if (!node.init || !isProcessEnv(node.init)) return;
        if (!node.id || node.id.type !== "ObjectPattern") return;
        for (const prop of node.id.properties) {
          if (!prop || prop.type !== "Property") continue;
          // The `key` is the source name on process.env; that's what
          // we test against BANNED_KEYS regardless of any local alias.
          if (prop.computed) continue;
          const k = prop.key;
          let keyName = null;
          if (k && k.type === "Identifier") keyName = k.name;
          else if (k && k.type === "Literal" && typeof k.value === "string")
            keyName = k.value;
          if (!keyName) continue;
          if (!BANNED_KEYS.has(keyName)) continue;
          context.report({ node: prop, messageId: "forbiddenRead" });
        }
      },
    };
  },
};

export default rule;
