"use client";

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { ExecLedgerProvider, useExecLedger } from "./data/ledger-context";
import { BlockDataProvider } from "./block-data";
import { RecordingProvider, RecordingVignette } from "@/shell/teach";
import { SandboxDataSync } from "./sandbox-data-sync";

/**
 * Cascade's provider stack, mounted BELOW `CopilotKitProvider` as
 * `skin.Providers` — mirroring people's `providers.tsx`
 * (`src/skins/people/providers.tsx`).
 *
 * Everything the skin renders — the chat transcript's inline A2UI blocks AND
 * the dashboard pages — mounts inside this one stack, so a single ledger
 * fetch and a single teach-mode recorder cover both.
 *
 *  - `ExecLedgerProvider` — the one `GET /api/exec/v1/ledger` read
 *    (`./data/ledger-context.tsx`), shared by pages, the block catalog, and
 *    `SandboxDataSync` below.
 *  - `BlockDataBridge` — adapts the ledger's richer context (mutations,
 *    `refresh`, narratives, packs, …) down to the narrow `{ snapshot,
 *    addBlock, isPinned }` shape `BlockDataProvider` (`./block-data.tsx`)
 *    hands to A2UI block renderers. See its own doc comment for why
 *    `isPinned` is derived rather than tracked.
 *  - `RecordingProvider` + `RecordingVignette` — the shell's ONE teach-mode
 *    recorder (`@/shell/teach`), the same implementation banking, people and
 *    airline mount.
 *  - `SandboxDataSync` — keeps the OGUI sandbox's module-scope snapshot
 *    (`./sandbox-functions.ts`) in sync with the live ledger, so generated
 *    UI inside an OGUI iframe reads real data instead of the empty seed.
 *
 * NO `RuntimeProviders` here, deliberately. `useExecRuntimeProperties`
 * (`./runtime-properties.ts`) reads no context — Cascade has one persona (the
 * chief of staff) and no operator switcher, so it returns a frozen module
 * constant, exactly like airline's `useAirlineRuntimeProperties`
 * (`src/skins/airline/runtime-properties.ts`). There is nothing to establish
 * above `CopilotKitProvider`, so this file exports no such slot — that is not
 * an oversight.
 */

/**
 * Adapts `useExecLedger()`'s full context down to the `BlockData` shape A2UI
 * block renderers consume through `useBlockData()`.
 *
 * `isPinned(blockId)` answers whether a block is currently mounted on ANY
 * dashboard, derived fresh from the snapshot rather than tracked as separate
 * state: the ledger is already the one source of truth for dashboard
 * membership, and a derived boolean can never drift from it the way a
 * parallel "pinned ids" set could after an out-of-band `removeBlock`.
 */
function BlockDataBridge({ children }: { children: ReactNode }) {
  const { snapshot, addBlock } = useExecLedger();

  const isPinned = useCallback(
    (blockId: string) =>
      Object.values(snapshot.dashboards).some((dashboard) =>
        dashboard.blocks.some((block) => block.id === blockId),
      ),
    [snapshot],
  );

  const value = useMemo(
    () => ({ snapshot, addBlock, isPinned }),
    [snapshot, addBlock, isPinned],
  );

  return <BlockDataProvider value={value}>{children}</BlockDataProvider>;
}

/** Below CopilotKitProvider. */
export function ExecProviders({ children }: { children: ReactNode }) {
  return (
    <ExecLedgerProvider>
      <BlockDataBridge>
        <RecordingProvider>
          <SandboxDataSync />
          {children}
          <RecordingVignette />
        </RecordingProvider>
      </BlockDataBridge>
    </ExecLedgerProvider>
  );
}
