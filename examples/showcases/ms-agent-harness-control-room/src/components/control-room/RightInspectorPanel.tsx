"use client";

/**
 * Right column: inspector panels backed by `ControlRoomStateSnapshot` and
 * the agent's observer feeds.
 *
 * Task 6 split the previously inline inspector cards into dedicated
 * components under `inspectors/`:
 *
 *  - `<LiveStatePanel />`, `<TodoPanel />`, `<MemoryPanel />` — native
 *    primitives backed by `useCoAgent` state, no badge.
 *  - `<ObserverPanels />` — repo / test / tool / state observer cards plus
 *    the feature autodetection list. The four observer cards are *live
 *    wrappers* and display `<PrimitiveWrapperBadge />`; the feature card is
 *    native and omits it.
 */

import { ConnectionStatus } from "@/components/control-room/ConnectionStatus";
import { LiveStatePanel } from "@/components/control-room/inspectors/LiveStatePanel";
import { MemoryPanel } from "@/components/control-room/inspectors/MemoryPanel";
import { ObserverPanels } from "@/components/control-room/inspectors/ObserverPanels";
import { SkillsPanel } from "@/components/control-room/inspectors/SkillsPanel";
import { StructuredDiagnosisPanel } from "@/components/control-room/inspectors/StructuredDiagnosisPanel";
import { TodoPanel } from "@/components/control-room/inspectors/TodoPanel";

export function RightInspectorPanel() {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <LiveStatePanel />
      <TodoPanel />
      <MemoryPanel />
      <SkillsPanel />
      <StructuredDiagnosisPanel />
      <ObserverPanels />
      <div className="cr-card">
        <h3 className="cr-heading mb-2">Connection status</h3>
        <ConnectionStatus />
      </div>
    </div>
  );
}
