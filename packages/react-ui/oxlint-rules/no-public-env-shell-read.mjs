/**
 * Oxlint rule: no-public-env-shell-read
 *
 * Bans direct reads of `process.env.NEXT_PUBLIC_<URL/ANALYTICS>` keys in
 * showcase shell client/server code. Those values are now served at runtime
 * via `getRuntimeConfig()` (see workstream B / Option-B migration), and a
 * stray `process.env.NEXT_PUBLIC_*` read would silently re-freeze the value
 * at build time and regress the migration.
 *
 * Allowed (intentionally NOT in the banned set):
 *   - `NEXT_PUBLIC_COMMIT_SHA`   — build-stamped artifact identifier
 *   - `NEXT_PUBLIC_BRANCH`       — build-stamped artifact identifier
 *   - `NEXT_PUBLIC_LOCAL_BACKENDS` — local-dev only, computed from
 *     `shared/local-ports.json` at build time (not a real env var)
 *
 * Banned keys:
 *   NEXT_PUBLIC_POCKETBASE_URL, NEXT_PUBLIC_SHELL_URL, NEXT_PUBLIC_BASE_URL,
 *   NEXT_PUBLIC_OPS_BASE_URL, NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL,
 *   NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST,
 *   NEXT_PUBLIC_SCARF_PIXEL_ID, NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID,
 *   NEXT_PUBLIC_REB2B_KEY, NEXT_PUBLIC_REO_KEY
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

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct `process.env.NEXT_PUBLIC_*` URL/analytics reads in shell code (use getRuntimeConfig)",
    },
    schema: [],
    messages: {
      forbiddenRead:
        "Do not read process.env.NEXT_PUBLIC_* directly in shell code. Use getRuntimeConfig() from @/lib/runtime-config.client (client) or @/lib/runtime-config (server). See workstream B.",
    },
  },

  create(context) {
    return {
      // Match `process.env.<KEY>` — i.e. a MemberExpression whose object is
      // itself the MemberExpression `process.env` and whose property is the
      // banned identifier.
      MemberExpression(node) {
        const obj = node.object;
        if (
          !obj ||
          obj.type !== "MemberExpression" ||
          obj.computed ||
          !obj.object ||
          obj.object.type !== "Identifier" ||
          obj.object.name !== "process" ||
          !obj.property ||
          obj.property.type !== "Identifier" ||
          obj.property.name !== "env"
        ) {
          return;
        }
        // `node.property` is the key being read off `process.env`.
        // Only flag the static dotted form (`process.env.FOO`) or the
        // literal-string computed form (`process.env["FOO"]`).
        let keyName = null;
        if (!node.computed && node.property && node.property.type === "Identifier") {
          keyName = node.property.name;
        } else if (
          node.computed &&
          node.property &&
          node.property.type === "Literal" &&
          typeof node.property.value === "string"
        ) {
          keyName = node.property.value;
        }
        if (!keyName) return;
        if (!BANNED_KEYS.has(keyName)) return;

        context.report({ node, messageId: "forbiddenRead" });
      },
    };
  },
};

export default rule;
