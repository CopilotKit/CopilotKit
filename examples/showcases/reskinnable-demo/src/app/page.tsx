import { redirect } from "next/navigation";
import { defaultSkinId } from "@/shell/skins-config";
import { lockedSkinId } from "@/lib/locked-skin";

// The app is multi-skin; `/` has no content of its own. Redirect to the active
// skin's root — the LOCK_SKIN skin on a single-tenant deploy, otherwise the
// default. Honouring the lock here is not cosmetic: without it a locked deploy
// would send its front door to `defaultSkinId`, which then 404s.
// Imports pure config (no client skin modules) so this stays a server component.
//
// LOCK_SKIN is a *runtime* env, but reading process.env is not a dynamic API,
// so nothing here opts `/` out of static generation on its own. Without this
// `next build` prerenders `/` and bakes the build-time skin into the redirect
// target — a deploy built unset then run locked would 404 at its front door.
// force-dynamic evaluates lockedSkinId() per request instead.
export const dynamic = "force-dynamic";

export default function RootIndex() {
  redirect(`/${lockedSkinId() ?? defaultSkinId}`);
}
