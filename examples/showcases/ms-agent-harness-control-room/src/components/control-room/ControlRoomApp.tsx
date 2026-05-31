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
import { PanelLeft } from "lucide-react";

import { CenterWorkstream } from "@/components/control-room/CenterWorkstream";
import {
  GenerativeUICatalogProvider,
  GenerativeUIRegistry,
} from "@/components/control-room/GenerativeUICatalog";
import { ShowcaseSidebar } from "@/components/control-room/ShowcaseSidebar";
import { ToolRendererRegistry } from "@/components/control-room/renderers/ToolRendererRegistry";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TooltipProvider,
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
      <ShowcaseDrawer />
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-2 lg:grid-cols-[420px_minmax(0,1fr)]">
        <Pane className="hidden lg:flex">
          <ShowcaseSidebarFrame />
        </Pane>
        <Pane>
          <CenterWorkstream />
        </Pane>
      </div>
    </div>
  );
}

function ShowcaseDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Showcase sidebar"
        title="Showcase"
        onClick={() => setOpen(true)}
        className="absolute left-3 top-3 z-10 rounded-2xl bg-background/95 shadow-sm backdrop-blur lg:hidden"
      >
        <PanelLeft className="text-primary" />
      </Button>
      <SheetContent side="left" className="w-[96vw] max-w-[96vw] overflow-hidden p-0 sm:max-w-[560px]">
        <SheetHeader className="sr-only">
          <SheetTitle>CopilotKit and Microsoft guided repair demo</SheetTitle>
          <SheetDescription>
            Harness plans, patches, approves, and verifies a seeded repair.
          </SheetDescription>
        </SheetHeader>
        <ShowcaseSidebarFrame className="h-full" />
      </SheetContent>
    </Sheet>
  );
}

function ShowcaseSidebarFrame({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <header className="border-b px-5 py-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex min-w-0 items-center gap-2">
            <img
              src="/brand/copilotkit-color.svg"
              alt=""
              aria-hidden
              className="size-4 shrink-0"
            />
            <span>CopilotKit</span>
          </span>
          <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
          <span className="flex min-w-0 items-center gap-2">
            <img
              src="/brand/microsoft-color.svg"
              alt=""
              aria-hidden
              className="size-4 shrink-0"
            />
            <span>Microsoft</span>
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Harness plans, patches, approves, and verifies a seeded repair.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <ShowcaseSidebar />
      </div>
    </div>
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
