"use client";

import {
  LayoutGrid,
  MessagesSquare,
  RotateCcw,
  SettingsIcon,
} from "lucide-react";
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
  ThreadsPanel,
  useIntelligenceEnabled,
} from "@/components/control-room/ThreadsPanel";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useControlRoomLocal } from "@/hooks/use-control-room-state";
import type { FixtureResetResult } from "@/lib/control-room-types";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

export function ShowcaseSidebar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
    >
      <ConnectionStatus />
      <ShowcaseHeader />
      <ShowcaseSidebarBody />
    </div>
  );
}

function ShowcaseSidebarBody() {
  const intelligenceEnabled = useIntelligenceEnabled();

  if (!intelligenceEnabled) {
    return <GenerativeUICatalogPanel className="min-h-0 flex-1" />;
  }

  return (
    <Tabs defaultValue="threads" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="cr-catalog-controls shrink-0 px-4">
        <TabsList
          variant="line"
          className="w-full justify-center gap-6 p-0 group-data-horizontal/tabs:h-10"
        >
          <TabsTrigger
            value="threads"
            className="h-full flex-none px-0.5 after:bg-primary data-active:text-primary group-data-horizontal/tabs:after:bottom-[-2px]"
          >
            <MessagesSquare className="size-3.5" />
            Threads
          </TabsTrigger>
          <TabsTrigger
            value="catalog"
            className="h-full flex-none px-0.5 after:bg-primary data-active:text-primary group-data-horizontal/tabs:after:bottom-[-2px]"
          >
            <LayoutGrid className="size-3.5" />
            Generative UI
          </TabsTrigger>
        </TabsList>
      </div>
      <Separator className="cr-catalog-rule shrink-0" />
      <TabsContent value="catalog" className="min-h-0 flex-1">
        <GenerativeUICatalogPanel className="h-full min-h-0" />
      </TabsContent>
      <TabsContent value="threads" className="min-h-0 flex-1">
        <ThreadsPanel className="h-full min-h-0" />
      </TabsContent>
    </Tabs>
  );
}

function ShowcaseHeader() {
  return (
    <header className="showcase-brand-card shrink-0 border-b px-12 py-3 sm:px-4">
      <div className="flex min-w-0 items-center justify-center">
        <BrandLockup />
      </div>
    </header>
  );
}

function BrandLockup() {
  return (
    <div className="flex min-w-0 items-center justify-center gap-2 text-[13px] font-semibold tracking-tight text-white sm:text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white/45"
          aria-hidden
        >
          <img src="/brand/copilotkit-color.svg" alt="" className="size-3.5" />
        </span>
        <span className="truncate">CopilotKit</span>
      </span>
      <span className="h-4 w-px shrink-0 bg-white/35" aria-hidden />
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-white/45"
          aria-hidden
        >
          <img src="/brand/microsoft-color.svg" alt="" className="size-3.5" />
        </span>
        <span className="truncate">Microsoft</span>
      </span>
    </div>
  );
}

export function HarnessSettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0 rounded-full text-primary hover:text-primary aria-expanded:text-primary"
          aria-label="Open Harness settings"
          title="Settings"
        >
          <SettingsIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0 sm:max-h-[88vh] sm:w-full sm:max-w-3xl">
        <DialogHeader className="min-w-0 overflow-hidden border-b px-5 py-4 pr-14 text-left sm:px-6 sm:py-5">
          <DialogTitle>Harness controls</DialogTitle>
          <DialogDescription className="max-w-full leading-relaxed">
            Agent state and setup tools for the workspace demo.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="harness-settings-scroll max-h-[calc(100dvh-7rem)] overflow-x-hidden sm:max-h-[calc(88vh-86px)]">
          <div className="p-3 sm:p-4">
            <Accordion
              type="multiple"
              defaultValue={["agent", "settings"]}
              className="space-y-3"
            >
              <AccordionItem
                value="agent"
                className="min-w-0 overflow-hidden rounded-3xl border bg-background px-3 shadow-sm sm:px-4"
              >
                <AccordionTrigger className="text-base">Agent</AccordionTrigger>
                <AccordionContent className="min-w-0 pb-3 sm:pb-4">
                  <div className="min-w-0 overflow-hidden rounded-2xl bg-muted/25">
                    <RightInspectorPanel />
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem
                value="settings"
                className="min-w-0 overflow-hidden rounded-3xl border bg-background px-3 shadow-sm sm:px-4"
              >
                <AccordionTrigger className="text-base">
                  Settings
                </AccordionTrigger>
                <AccordionContent className="min-w-0 pb-3 sm:pb-4">
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
