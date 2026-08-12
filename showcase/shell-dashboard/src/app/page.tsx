// Server component route shell. This file has NO "use client" directive,
// so it executes only on the server. It reads the runtime config at REQUEST
// time (`getRuntimeConfig()` calls `unstable_noStore()`, opting this segment
// out of the static cache — the route is dynamically rendered, matching the
// staging `cache-control: no-store` behavior) and threads the real
// `shellUrl` into the client `DashboardPage`.
//
// Why this matters: the dashboard tree is otherwise entirely "use client".
// A client component's `getRuntimeConfig()` (runtime-config.client.ts)
// returns the `https://ssr-placeholder.invalid/` SSR sentinel during SSR
// because `window` is undefined, and that dead sentinel was being baked into
// every Demo / Code `<a href>` and never re-derived after hydration. Reading
// the REAL host here, server-side, and passing it down means the anchors are
// built with the live host in the initial HTML — the `ssr-placeholder.invalid`
// SSR sentinel never reaches the DOM, links work pre-hydration (crawlers,
// no-JS), and the previously-dead links resolve correctly.
//
// NOTE: there is a SECOND, distinct sentinel — when `SHELL_URL` is unset on
// the Railway service, this server `getRuntimeConfig()` returns the truthy
// `about:blank#shell-url-missing` env-unset sentinel. `resolveShellUrl` in
// feature-grid.tsx does not return that value; instead it falls back to the
// client config (which during SSR is the `ssr-placeholder.invalid` sentinel),
// and the verify-deploy dashboard guard makes the unset case fail loud when it
// ships. So the only sentinel this server thread alone eliminates is the
// `ssr-placeholder.invalid` one — the env-unset case is handled downstream in
// resolveShellUrl, not here.
import { getRuntimeConfig } from "@/lib/runtime-config";
import { DashboardPage } from "@/components/dashboard-page";

export default function Page() {
  const { shellUrl } = getRuntimeConfig();
  return <DashboardPage shellUrl={shellUrl} />;
}
