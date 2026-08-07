"use client";

/**
 * Root client component for the MS Agent Harness Control Room cockpit.
 *
 * Wires CopilotKit v2 directly to the Harness agent over AG-UI. There is no
 * Next.js runtime middleman: `selfManagedAgents` accepts an `HttpAgent`
 * pointed straight at the agent's `/` endpoint. The agent's URL is held in
 * React state so the endpoint selector can repoint the cockpit at any
 * AG-UI-speaking host.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { HttpAgent } from "@ag-ui/client";

import { CenterWorkstream } from "@/components/control-room/CenterWorkstream";
import { ConnectionStatus } from "@/components/control-room/ConnectionStatus";
import { LeftControlPanel } from "@/components/control-room/LeftControlPanel";
import { RightInspectorPanel } from "@/components/control-room/RightInspectorPanel";
import { ToolRendererRegistry } from "@/components/control-room/renderers/ToolRendererRegistry";
import {
  CONTROL_ROOM_AGENT_NAME,
  ControlRoomProvider,
} from "@/hooks/use-control-room-state";
import { DEFAULT_ENDPOINT } from "@/lib/endpoint";

export function ControlRoomApp() {
  const [currentEndpoint, setCurrentEndpoint] =
    useState<string>(DEFAULT_ENDPOINT);

  // Rebuild the HttpAgent each time the endpoint changes; passing the same
  // instance across renders is fine, but a new endpoint requires a new agent.
  const agents = useMemo(
    () => ({
      [CONTROL_ROOM_AGENT_NAME]: new HttpAgent({ url: currentEndpoint }),
    }),
    [currentEndpoint],
  );

  return (
    <CopilotKitProvider selfManagedAgents={agents}>
      <ControlRoomProvider
        currentEndpoint={currentEndpoint}
        setCurrentEndpoint={setCurrentEndpoint}
      >
        <ToolRendererRegistry />
        <ThreePaneLayout />
      </ControlRoomProvider>
    </CopilotKitProvider>
  );
}

function ThreePaneLayout() {
  return (
    <div className="cockpit-shell flex h-screen flex-col">
      <HeaderBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[var(--cr-border)] lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        <Pane label="CONTROLS">
          <LeftControlPanel />
        </Pane>
        <Pane label="WORKSTREAM" tone="primary">
          <CenterWorkstream />
        </Pane>
        <Pane label="INSPECTORS">
          <RightInspectorPanel />
        </Pane>
      </div>
      <StatusFooter />
    </div>
  );
}

function HeaderBar() {
  return (
    <header className="relative flex shrink-0 items-center justify-between border-b border-[var(--cr-border)] bg-[var(--cr-surface)] px-5 py-2.5">
      <div className="flex items-center gap-4">
        {/* HUD glyph — three stacked rules, mission-control flavor */}
        <div className="flex flex-col gap-0.5" aria-hidden>
          <span className="block h-px w-7 bg-[var(--cr-amber)]" />
          <span className="block h-px w-5 bg-[var(--cr-emerald)]" />
          <span className="block h-px w-3 bg-[var(--cr-cyan)]" />
        </div>
        <div>
          <h1
            className="text-[15px] font-semibold tracking-tight text-[var(--cr-fg-strong)]"
            style={{ fontFamily: "var(--cr-font-display)" }}
          >
            MS Agent Harness · Control Room
          </h1>
          <p
            className="text-[10.5px] uppercase tracking-[0.2em] text-[var(--cr-muted)]"
            style={{ fontFamily: "var(--cr-font-mono)" }}
          >
            CopilotKit&nbsp;v2 · AG-UI · Harness 1.6.2
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="hidden text-right text-[10px] leading-tight uppercase tracking-[0.2em] text-[var(--cr-muted)] md:block"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          <div>Conference build</div>
          <div className="text-[var(--cr-muted-2)]">MSFT Build · June 2026</div>
        </div>
        <div className="min-w-[260px] max-w-[420px]">
          <ConnectionStatus />
        </div>
      </div>
    </header>
  );
}

function Pane({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "primary";
  children: ReactNode;
}) {
  return (
    <section className="cockpit-panel flex min-h-0 flex-col overflow-hidden bg-[var(--cr-surface)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--cr-border)] bg-[var(--cr-surface-2)] px-4 py-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--cr-muted-2)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {label}
        </span>
        <span
          aria-hidden
          className={
            "h-1.5 w-1.5 rounded-full " +
            (tone === "primary"
              ? "bg-[var(--cr-amber)] shadow-[0_0_8px_var(--cr-amber)]"
              : "bg-[var(--cr-dim)]")
          }
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function StatusFooter() {
  return (
    <footer
      className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--cr-border)] bg-[var(--cr-surface)] px-5 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[var(--cr-muted)]"
      style={{ fontFamily: "var(--cr-font-mono)" }}
    >
      <div className="flex items-center gap-4">
        <span className="text-[var(--cr-emerald)]">● ACTIVE</span>
        <span>v2 · selfManagedAgents</span>
        <span className="hidden md:inline">Responses · gpt-5.4</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden md:inline">
          localhost:3000 → localhost:8000
        </span>
        <span>uptime: live</span>
      </div>
    </footer>
  );
}

/**
 * Card primitive used by the cockpit panels — kept here so a single place
 * defines the chrome and ToolRendererRegistry can reuse it.
 */
export function CockpitCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={"cr-card " + (className ?? "")}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <span className="cr-heading">{title}</span>}
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}
