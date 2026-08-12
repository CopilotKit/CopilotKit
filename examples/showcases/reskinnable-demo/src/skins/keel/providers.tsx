"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import { RoleProvider, useRole } from "@/skins/keel/role-context";
import { KeelLedgerProvider } from "@/skins/keel/ledger-context";

/**
 * Keel's `RuntimeProviders` — mounted by the shell ABOVE `CopilotKitProvider`.
 * It establishes the active-persona context (`RoleProvider`) so that
 * `useKeelRuntimeProperties` (below) can read the persona and the shell can
 * thread it into the provider's `properties` prop.
 *
 * Why ABOVE, not below: `properties` is a PROP of `CopilotKitProvider`, so its
 * source must already exist when the provider first commits. Mounting the
 * persona context above the provider makes the provider the sole owner of the
 * property bag from render one — no child racing an imperative `setProperties`
 * after mount, which would make the identity "eventually correct if effects
 * fire in the right order" instead of correct from the very first run.
 *
 * `KeelLedgerProvider` sits inside it, and for the reason commerce's provider
 * states: everything below — `Tools`, the layout, and every page — must read the
 * SAME `GET /ledger` snapshot, or beat 3b has a panel and a readable one fetch
 * apart. It goes here rather than in `Providers` (which mounts BELOW
 * `CopilotKitProvider`) so the layout's route readable and the tools' state
 * readables are fed from one source. Unlike commerce, nothing in keel's
 * `useRuntimeProperties` reads the ledger — the persona is a static module — so
 * the order of these two providers is a matter of scope, not of a race.
 */
export function KeelRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      <KeelLedgerProvider>{children}</KeelLedgerProvider>
    </RoleProvider>
  );
}

/**
 * Keel's `useRuntimeProperties`. Reads the active persona (established above by
 * `KeelRuntimeProviders`) and returns the runtime `properties` the shell threads
 * into `CopilotKitProvider`. The shell adds `a2uiCatalogAvailable: true` itself
 * when a catalog is present, so it is deliberately NOT set here. Memoized on the
 * persona's id/role so the object identity is stable across renders and a run
 * re-scopes only when (and only when) the persona actually changes.
 */
export function useKeelRuntimeProperties(): Record<string, unknown> {
  const { persona } = useRole();
  return useMemo(
    () => ({ userRole: persona.role, userId: persona.id }),
    [persona.id, persona.role],
  );
}

/**
 * Keel's `Providers` — the BELOW-provider stack, mounted by the shell inside
 * `CopilotKitProvider`. Everything here may consume the CopilotKit context, which
 * is why it cannot be hoisted into `KeelRuntimeProviders` above.
 *
 * ── BEAT 6: WHY `RecordingProvider` IS HERE AND NOT PER SURFACE ─────────────
 *
 * The teach-mode recorder has to wrap BOTH cards the shell frame draws. The
 * DEMONSTRATION happens on the Register — the operator files a variance in
 * `components/variance-form.tsx` — while the card that reads `steps` and
 * `getDemonstratedCode()` lives in the TRANSCRIPT
 * (`components/demonstration-card.tsx`, inside `awaitDemonstration`'s interrupt).
 * A provider mounted around only one of them makes every `logStep` from the other
 * a SILENT no-op: `useRecording` returns inert fallbacks outside a provider and
 * `logStep` returns early when idle, so nothing throws — the feed is simply empty,
 * the glow never appears, and it is discovered on stage. `skin.Providers` is the
 * one mount point that encloses both, which is where banking, logistics, people
 * and commerce all put it.
 *
 * Imported from `@/shell/teach`, NEVER re-implemented: three skins shipped private
 * copies and they diverged silently.
 *
 * `RecordingVignette` is last and is a SIBLING of `children` rather than a
 * wrapper, so the canvas-edge glow overlays the whole frame without joining the
 * layout. Its styling reads the shared brand tokens, so it reskins with
 * `theme.css` and needs no keel-specific copy.
 *
 * Keel's OGUI snapshot sync is deliberately NOT here — `KeelSandboxDataSync` is
 * returned by `KeelTools`, which the shell already mounts below the provider.
 * Moving it would give the skin two sync mounts.
 */
export function KeelProviders({ children }: { children: ReactNode }) {
  return (
    <RecordingProvider>
      {children}
      <RecordingVignette />
    </RecordingProvider>
  );
}
