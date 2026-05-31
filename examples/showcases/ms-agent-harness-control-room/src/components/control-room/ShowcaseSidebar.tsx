"use client";

import {
  ChartNoAxesCombined,
  Code2,
  RotateCcw,
  Settings,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

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
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
    label: "Chat UI",
    description: "Components the agent can render in chat.",
    icon: ChartNoAxesCombined,
    tone: "border-violet-200 bg-violet-50 text-violet-600",
  },
  {
    id: "state",
    label: "Evidence",
    description: "Live Harness mode, todos, files, approvals, and memory.",
    icon: Code2,
    tone: "border-cyan-200 bg-cyan-50 text-cyan-700",
  },
  {
    id: "settings",
    label: "Setup",
    description: "Endpoint, commands, structured output, and skills.",
    icon: Settings,
    tone: "border-slate-200 bg-slate-50 text-slate-700",
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
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <ConnectionStatus />
      <Tabs
        value={activePanelId}
        onValueChange={(value) => setActivePanelId(value as ShowcasePanelId)}
        className="min-h-0 flex-1 gap-0"
      >
        {activePanel.id === "generative" ? (
          <GenerativeUICatalogPanel tabsSlot={<PanelTabs />} />
        ) : activePanel.id === "state" ? (
          <StatePanel tabsSlot={<PanelTabs />} />
        ) : (
          <AdvancedControlsPanel tabsSlot={<PanelTabs />} />
        )}
      </Tabs>
    </div>
  );
}

function PanelTabs() {
  return (
    <div className="border-b bg-muted/25 px-4 py-2.5">
      <TabsList className="grid !h-9 w-full grid-cols-3 gap-1 overflow-hidden rounded-xl bg-muted p-1">
        {SIDEBAR_PANELS.map((panel) => {
          const Icon = panel.icon;
          return (
            <TabsTrigger
              key={panel.id}
              value={panel.id}
              aria-label={panel.label}
              title={panel.description}
              className="h-7 min-w-0 justify-center gap-1.5 rounded-lg px-2 py-0 text-center text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  panel.tone,
                )}
                aria-hidden
              >
                <Icon className="size-3" />
              </span>
              <span className="min-w-0 truncate">
                {panel.label}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </div>
  );
}

function StatePanel({ tabsSlot }: { tabsSlot: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden">
      {tabsSlot}
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/25">
        <div className="min-w-0 max-w-full overflow-hidden">
          <RightInspectorPanel />
        </div>
      </ScrollArea>
    </div>
  );
}

export function AdvancedControlsPanel({ tabsSlot }: { tabsSlot: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabsSlot}
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
