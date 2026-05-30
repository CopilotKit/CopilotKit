"use client";

import {
  ChartNoAxesCombined,
  Code2,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";

import { CommandControls } from "@/components/control-room/CommandControls";
import { ConnectionStatus } from "@/components/control-room/ConnectionStatus";
import { EndpointSelector } from "@/components/control-room/EndpointSelector";
import { GenerativeUICatalogPanel } from "@/components/control-room/GenerativeUICatalog";
import { FeatureAutodetectPanel } from "@/components/control-room/inspectors/ObserverPanels";
import { SkillsPanel } from "@/components/control-room/inspectors/SkillsPanel";
import { StructuredDiagnosisPanel } from "@/components/control-room/inspectors/StructuredDiagnosisPanel";
import { ModeControls } from "@/components/control-room/ModeControls";
import { RightInspectorPanel } from "@/components/control-room/RightInspectorPanel";
import { StructuredOutputControl } from "@/components/control-room/StructuredOutputControl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useControlRoomLocal,
} from "@/hooks/use-control-room-state";
import type { FixtureResetResult } from "@/lib/control-room-types";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

type ShowcasePanelId = "generative" | "state" | "settings";

const SIDEBAR_PANELS: Array<{
  id: ShowcasePanelId;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  tone: string;
}> = [
  {
    id: "generative",
    label: "Generative UI",
    description: "Components the agent can render in chat.",
    icon: ChartNoAxesCombined,
    tone: "text-violet-600 bg-violet-50 border-violet-200",
  },
  {
    id: "state",
    label: "State",
    description: "Live Harness mode, todos, files, approvals, and memory.",
    icon: Code2,
    tone: "text-cyan-700 bg-cyan-50 border-cyan-200",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Endpoint, commands, structured output, and skills.",
    icon: Settings,
    tone: "text-slate-700 bg-slate-50 border-slate-200",
  },
];

export function ShowcaseSidebar({
  className,
}: {
  className?: string;
}) {
  const [activePanelId, setActivePanelId] =
    useState<ShowcasePanelId>("generative");
  const activePanel = useMemo(
    () =>
      SIDEBAR_PANELS.find((panel) => panel.id === activePanelId) ??
      SIDEBAR_PANELS[0],
    [activePanelId],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 overflow-hidden bg-background",
        className,
      )}
    >
      <ConnectionStatus />
      <aside className="flex w-16 shrink-0 flex-col items-center border-r bg-muted/25 p-3">
        <nav className="flex flex-1 flex-col items-center gap-2">
          {SIDEBAR_PANELS.map((panel) => {
            const Icon = panel.icon;
            const isActive = panel.id === activePanelId;
            return (
              <Tooltip key={panel.id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="icon"
                    aria-label={panel.label}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setActivePanelId(panel.id)}
                    className={cn(
                      "size-9 rounded-2xl shadow-sm",
                      !isActive && panel.tone,
                    )}
                  >
                    <Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" sideOffset={10}>
                  {panel.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {activePanel.id === "generative" ? (
          <GenerativeUICatalogPanel />
        ) : activePanel.id === "state" ? (
          <StatePanel />
        ) : (
          <AdvancedControlsPanel />
        )}
      </section>
    </div>
  );
}

function StatePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Harness state"
        description="Live Agent Harness evidence grouped for the demo."
        badge="AG-UI"
      />
      <ScrollArea className="min-h-0 flex-1 bg-muted/25">
        <RightInspectorPanel />
      </ScrollArea>
    </div>
  );
}

export function AdvancedControlsPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Settings"
        description="Tools for setup, manual runs, structured output, and skills."
        badge="Advanced"
      />
      <ScrollArea className="min-h-0 flex-1 bg-muted/25">
        <div className="space-y-4 p-4">
          <EndpointSelector />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Fixture</CardTitle>
              <CardDescription>
                Reset the sandbox or reconnect to the Harness endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <FixtureResetButton compact />
              <ReconnectButton />
            </CardContent>
          </Card>
          <ModeControls />
          <CommandControls />
          <StructuredOutputControl />
          <SkillsPanel />
          <StructuredDiagnosisPanel />
          <FeatureAutodetectPanel />
        </div>
      </ScrollArea>
    </div>
  );
}

function PanelHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Badge variant="secondary" className="shrink-0">
        {badge}
      </Badge>
    </header>
  );
}

function ReconnectButton({ className }: { className?: string }) {
  const { localState, bumpReconnect } = useControlRoomLocal();
  return (
    <Button
      type="button"
      onClick={bumpReconnect}
      className={cn("flex-1", className)}
      variant="outline"
      size="sm"
      title={`Reconnect attempts: ${localState.reconnectAttempts}`}
    >
      <RotateCcw size={13} />
      Reconnect
    </Button>
  );
}

function FixtureResetButton({
  compact = false,
  buttonClassName,
}: {
  compact?: boolean;
  buttonClassName?: string;
}) {
  const { localState } = useControlRoomLocal();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FixtureResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/fixture/reset", {
        method: "POST",
        headers: {
          [CONTROL_ROOM_ENDPOINT_HEADER]: localState.currentEndpoint,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult((await response.json()) as FixtureResetResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "flex-1" : ""}>
      <Button
        type="button"
        onClick={reset}
        disabled={busy}
        className={cn("w-full", buttonClassName)}
        variant={compact ? "outline" : "secondary"}
        size="sm"
      >
        <RotateCcw size={13} />
        {busy ? "Resetting" : compact ? "Reset" : "Reset fixture repo"}
      </Button>
      {result && !compact ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {result.reset
            ? `Reset OK · ${result.file_count} file${result.file_count === 1 ? "" : "s"}`
            : "Reset reported no-op."}
        </p>
      ) : null}
      {error && !compact ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
