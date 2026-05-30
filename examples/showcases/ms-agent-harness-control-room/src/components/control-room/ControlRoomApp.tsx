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
import { ClipboardList, Code2 } from "lucide-react";

import { CenterWorkstream } from "@/components/control-room/CenterWorkstream";
import {
  GenerativeUICatalogDrawer,
  GenerativeUICatalogProvider,
  GenerativeUIRegistry,
} from "@/components/control-room/GenerativeUICatalog";
import { LeftControlPanel } from "@/components/control-room/LeftControlPanel";
import { RightInspectorPanel } from "@/components/control-room/RightInspectorPanel";
import { AdvancedControlsDrawer, StageRail } from "@/components/control-room/StageRail";
import { topRailButtonClass } from "@/components/control-room/top-rail-button";
import { ToolRendererRegistry } from "@/components/control-room/renderers/ToolRendererRegistry";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CONTROL_ROOM_AGENT_NAME,
  ControlRoomProvider,
} from "@/hooks/use-control-room-state";
import { DEFAULT_ENDPOINT } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

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
        <GenerativeUICatalogProvider>
          <ToolRendererRegistry />
          <GenerativeUIRegistry />
          <TooltipProvider>
            <ThreePaneLayout />
          </TooltipProvider>
        </GenerativeUICatalogProvider>
      </ControlRoomProvider>
    </CopilotKitProvider>
  );
}

function ThreePaneLayout() {
  return (
    <div className="cockpit-shell flex h-[100dvh] flex-col p-2">
      <TopIconRail />
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-2 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Pane className="hidden lg:flex">
          <LeftControlPanel />
        </Pane>
        <Pane>
          <CenterWorkstream />
        </Pane>
      </div>
    </div>
  );
}

function TopIconRail() {
  return (
    <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-2xl border bg-background/95 p-1 shadow-sm backdrop-blur lg:right-4 lg:top-4">
      <MobileStepsDrawer />
      <StateDrawer />
      <GenerativeUICatalogDrawer />
      <AdvancedControlsDrawer iconOnly />
    </div>
  );
}

function MobileStepsDrawer() {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Steps"
              className={cn("lg:hidden", topRailButtonClass("indigo"))}
            >
              <ClipboardList />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" sideOffset={8}>
          Steps
        </TooltipContent>
      </Tooltip>
      <SheetContent className="w-[360px] max-w-[94vw] overflow-hidden p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Guided steps</SheetTitle>
          <SheetDescription>
            Presenter flow for the repair demo.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1">
          <StageRail inDrawer />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StateDrawer() {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="State"
              className={topRailButtonClass("cyan")}
            >
              <Code2 />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" sideOffset={8}>
          State
        </TooltipContent>
      </Tooltip>
      <SheetContent className="w-[420px] max-w-[92vw] overflow-y-auto p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Harness Evidence</SheetTitle>
          <SheetDescription>
            Live state from the current Agent Harness run.
          </SheetDescription>
        </SheetHeader>
        <RightInspectorPanel />
      </SheetContent>
    </Sheet>
  );
}

function Pane({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "cockpit-panel flex min-h-0 flex-col overflow-hidden border border-border ring-1 ring-border/30",
        className,
      )}
    >
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
