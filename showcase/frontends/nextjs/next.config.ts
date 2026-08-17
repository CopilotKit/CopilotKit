import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explicit marker that iframe embedding is intentionally unrestricted, so
  // nobody later adds a restrictive default "for safety".
  //
  // These two headers are DECORATIVE, not load-bearing. `X-Frame-Options`
  // accepts only `DENY` and `SAMEORIGIN`; `ALLOWALL` is not a valid value, so
  // browsers ignore the header entirely. `frame-ancestors *` is the permissive
  // default — identical to sending no CSP at all. With NEITHER header these
  // pages are ALREADY embeddable in the showcase shells. Do not describe them
  // as what enables embedding, and do not "fix" a broken embed by editing them.
  //
  // They are still worth keeping for two reasons: they state the intent in
  // code, and they are the cheapest runtime proof that this config file was
  // loaded at all (`curl -I` on a running container shows them), which is what
  // the genuinely load-bearing `serverExternalPackages` below depends on.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
  // `built-in-agent` is the one integration whose agent runs INSIDE this
  // process (`agent_kind: in-process`), so `@copilotkit/runtime` is executed
  // server-side here rather than only proxied to. Bundling it breaks that;
  // built-in-agent's own app sets the same flag for the same reason. Every
  // other integration reaches its agent over HTTP and would not need this.
  serverExternalPackages: ["@copilotkit/runtime"],
  // Type errors do NOT fail `next build`. This app carries 43 demos ported from
  // 20 integrations that pin different upstream SDK versions, so their type
  // surfaces drift against the single dependency set installed here; a build
  // that refuses to emit on any one of those drifts would block every demo.
  //
  // What replaces the build check, EXACTLY — do not overstate it:
  //   • `npm run typecheck` (`tsc --noEmit`) reports 49 errors on a clean tree
  //     right now. The types here are NOT clean and no gate claims they are.
  //   • CI runs that script in the `frontend-nextjs-unit-tests` job of
  //     .github/workflows/showcase_validate.yml, as a BASELINE gate: it counts
  //     the errors and fails only if the count RISES above the baseline pinned
  //     in that job (`TSC_ERROR_BASELINE`). So a NEW type error anywhere under
  //     src/ is blocked; the inherited 49 are not.
  //   • Nothing else typechecks this app. It has no project.json and is not a
  //     pnpm-workspace member, so static_quality.yml's
  //     `nx run-many -t check-types` cannot select it — and this script is
  //     named `typecheck`, not `check-types`, so the target would not match
  //     even if it could.
  //
  // Never read a green `next build` as "types are clean" — it says nothing at
  // all about types. Run `npm run typecheck` and read the errors.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
