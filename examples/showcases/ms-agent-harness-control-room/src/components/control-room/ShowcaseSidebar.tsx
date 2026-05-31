"use client";

import { RotateCcw, SettingsIcon } from "lucide-react";
import { useState } from "react";

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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import type { FixtureResetResult } from "@/lib/control-room-types";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

export function ShowcaseSidebar({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <ConnectionStatus />
      <ShowcaseHeader />
      <GenerativeUICatalogPanel className="min-h-0 flex-1" />
    </div>
  );
}

function ShowcaseHeader() {
  return (
    <header className="m-3 mb-2 rounded-[24px] border bg-background px-4 py-3 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <BrandLockup />
        <HarnessSettingsDialog />
      </div>
    </header>
  );
}

function BrandLockup() {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold tracking-tight">
      <span className="flex min-w-0 items-center gap-2">
        <img
          src="/brand/copilotkit-color.svg"
          alt=""
          aria-hidden
          className="size-4 shrink-0"
        />
        <span className="truncate">CopilotKit</span>
      </span>
      <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
      <span className="flex min-w-0 items-center gap-2">
        <img
          src="/brand/microsoft-color.svg"
          alt=""
          aria-hidden
          className="size-4 shrink-0"
        />
        <span className="truncate">Microsoft</span>
      </span>
    </div>
  );
}

function HarnessSettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0 rounded-full"
          aria-label="Open Harness settings"
          title="Settings"
        >
          <SettingsIcon className="text-slate-700" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>Harness controls</DialogTitle>
          <DialogDescription>
            Agent state and setup tools for the guided repair demo.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(88vh-86px)]">
          <div className="p-4">
            <Accordion
              type="multiple"
              defaultValue={["agent", "settings"]}
              className="space-y-3"
            >
              <AccordionItem
                value="agent"
                className="overflow-hidden rounded-3xl border bg-background px-4 shadow-sm"
              >
                <AccordionTrigger className="text-base">
                  Agent
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="min-w-0 overflow-hidden rounded-2xl bg-muted/25">
                    <RightInspectorPanel />
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem
                value="settings"
                className="overflow-hidden rounded-3xl border bg-background px-4 shadow-sm"
              >
                <AccordionTrigger className="text-base">
                  Settings
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <SettingsControls />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SettingsControls() {
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <div className="space-y-4">
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
      </div>
      <div className="space-y-4">
        <StructuredOutputControl />
        <SkillsPanel />
        <StructuredDiagnosisPanel />
        <FeatureAutodetectPanel />
      </div>
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
