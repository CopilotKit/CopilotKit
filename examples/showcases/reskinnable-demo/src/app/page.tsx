import { redirect } from "next/navigation";
import { defaultSkinId } from "@/shell/skins-config";
import { lockedSkinId } from "@/lib/locked-skin";

// The app is multi-skin; `/` has no content of its own. This page is the
// UNLOCKED front door: it redirects `/` to the default skin's root. It imports
// pure config (no client skin modules) so it stays a server component.
//
// On a LOCK_SKIN deploy this page never runs. `src/proxy.ts` REWRITES `/` to
// `/<locked>` in place (no redirect) before routing reaches here, so the locked
// skin is served AT `/` and this component is unreachable. Verified in a running
// app: a locked server answers `GET /` with 200 and no redirect, and the `/`
// payload is the `/<locked>` route tree.
//
// So the `lockedSkinId()` read is dead on any supported deploy — it is null
// whenever this page actually runs (unlocked), and under a lock the proxy gets
// here first. It is kept only as a proxy-INDEPENDENT backup: were `/` ever to
// reach this page under a lock with the proxy absent, it targets the locked
// skin's REAL route `/<locked>` (which renders) rather than `defaultSkinId`
// (which 404s when it differs from the lock) or `/` (which would infinite-loop
// with no proxy to rewrite it). This is deliberately NOT the double-prefix trap:
// `/<locked>` is re-rewritten to `/<locked>/<locked>` only when the proxy is
// PRESENT, and when it is, this page never runs — the two conditions cannot
// co-occur.
//
// LOCK_SKIN is a *runtime* env, but reading process.env is not a dynamic API, so
// without force-dynamic `next build` would statically prerender `/` and bake the
// build-time skin into the redirect target, defeating the backup above on a
// one-build-serves-both deploy. force-dynamic evaluates lockedSkinId() per
// request instead.
export const dynamic = "force-dynamic";

export default function RootIndex() {
  redirect(`/${lockedSkinId() ?? defaultSkinId}`);
}
