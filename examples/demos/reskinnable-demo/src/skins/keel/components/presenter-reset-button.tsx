"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { usePresenterReset } from "@/shell/presenter-reset-context";
import { useKeelHref } from "@/skins/keel/href";

/**
 * The presenter/booth Reset control — the tenth demo requirement
 * (`demo-beats.md` § Presentation requirements), and the one that is easiest to
 * ship as a lie.
 *
 * ── WHY IT HARD-NAVIGATES RATHER THAN CALLING `refresh()` ───────────────────
 * The reset throws away every piece of client state the demo accumulated: the
 * thread, the canvas surface, the levers in the query string, the recorder's feed.
 * A soft refresh keeps all of it, so the register's rows would come back restored
 * while the transcript beside them still recited the writes the reset had just
 * removed. `window.location.assign(base)` is also the clean starting URL the demo
 * should always open on.
 *
 * ── WHY A NON-OK RESPONSE IS LOUD ───────────────────────────────────────────
 * `POST /api/keel/v1/dev/reset` answers 502 when the memory half fell short —
 * PARTIAL and total alike, deliberately — because a shortfall does not say WHICH
 * memory is missing, and a 200 here would walk the presenter to a clean-looking
 * app whose memory beats are quietly broken. So this branches on `res.ok` only,
 * and on a failure it says so and does NOT navigate: the page the presenter is
 * looking at is the evidence, and reloading it away is the last thing they need.
 *
 * ── WHY THE STORE IS TREATED AS RESET EVEN THEN ─────────────────────────────
 * `store.reset()` is the route's FIRST act, so a 502 still means the register was
 * restored. The alert says exactly that, rather than implying nothing happened —
 * "reset failed" on its own sends a presenter to re-press a button that already
 * worked.
 *
 * Rendered only when `PRESENTER_RESET_ENABLED` is set (or any non-production env),
 * read server-side in the root layout and threaded down by
 * `usePresenterReset()` — the same gate the route enforces. Gate them differently
 * and a booth shows a control that 403s.
 */
export function PresenterResetButton() {
  const enabled = usePresenterReset();
  const keelHref = useKeelHref();
  const [busy, setBusy] = useState(false);

  if (!enabled) return null;

  const onReset = async () => {
    if (
      !window.confirm(
        "Reset the demo? This restores the policy register, the runs and the " +
          "artifacts, clears every learned memory, and re-seeds the ones the demo " +
          "starts out already knowing.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/keel/v1/dev/reset", { method: "POST" });
      if (res.ok) {
        // Through `keelHref`, never a literal `/keel` — under a LOCK_SKIN deploy
        // this app is served at `/` and a hardcoded prefix would put the tenant
        // segment back in the address bar. `pnpm lint` enforces it.
        window.location.assign(keelHref());
        return;
      }
      setBusy(false);
      window.alert(
        `The register was restored, but durable MEMORY was not fully reset ` +
          `(HTTP ${res.status}). Beats 4, 5 and 6 may not be armed — see the ` +
          `server logs, then reset again.`,
      );
    } catch (err) {
      setBusy(false);
      window.alert(
        `Reset could not be confirmed: ${err instanceof Error ? err.message : String(err)}. ` +
          `The demo data may already have been restored — check the register.`,
      );
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onReset()}
      aria-label="Reset demo state"
      title="Reset demo state"
      className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline text-ink-muted transition-colors hover:bg-brand-soft hover:text-brand disabled:opacity-50"
    >
      <RotateCcw className="h-4 w-4" />
    </button>
  );
}

export default PresenterResetButton;
