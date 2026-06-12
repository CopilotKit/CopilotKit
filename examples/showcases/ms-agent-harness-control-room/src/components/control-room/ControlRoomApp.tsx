"use client";

/**
 * Root client component for the MS Agent Harness Control Room cockpit.
 *
 * Wires CopilotKit v2 to the local runtime, which proxies to the selected
 * Harness AG-UI endpoint. The endpoint remains client-selectable, but runtime
 * middleware can now enable A2UI and Open Generative UI.
 */

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { PanelLeft } from "lucide-react";

import {
  CenterWorkstream,
  ControlRoomSuggestions,
} from "@/components/control-room/CenterWorkstream";
import { controlRoomA2UICatalog } from "@/components/control-room/a2ui-catalog";
import {
  GenerativeUICatalogProvider,
  GenerativeUIRegistry,
} from "@/components/control-room/GenerativeUICatalog";
import {
  HarnessSettingsDialog,
  ShowcaseSidebar,
} from "@/components/control-room/ShowcaseSidebar";
import { ToolRendererRegistry } from "@/components/control-room/renderers/ToolRendererRegistry";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlRoomProvider } from "@/hooks/use-control-room-state";
import { CONTROL_ROOM_AGENT_NAME } from "@/lib/control-room-agent";
import { CONTROL_ROOM_ENDPOINT_HEADER, DEFAULT_ENDPOINT } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

export function ControlRoomApp() {
  const [currentEndpoint, setCurrentEndpoint] =
    useState<string>(DEFAULT_ENDPOINT);
  const [a2uiEnabled, setA2UIEnabled] = useState(true);
  const [openGenerativeUIEnabled, setOpenGenerativeUIEnabled] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(
    undefined,
  );
  // Bumped on every "New thread" so the chat remounts into a fresh,
  // non-explicit conversation (which is what shows the welcome screen)
  // even when activeThreadId is already undefined.
  const [freshThreadNonce, setFreshThreadNonce] = useState(0);

  const startFreshThread = useCallback(() => {
    setActiveThreadId(undefined);
    setFreshThreadNonce((nonce) => nonce + 1);
  }, []);

  // Saved-thread switches happen in place — CopilotChat receives the
  // threadId as a prop and handles detach/reset/replay internally. The
  // key changes only for fresh conversations, so each "New thread" click
  // remounts the chat with a newly minted non-explicit threadId (which is
  // what brings the welcome screen back).
  const chatSessionKey =
    activeThreadId === undefined ? `fresh-${freshThreadNonce}` : "thread";

  const runtimeHeaders = useCallback(
    () => ({
      [CONTROL_ROOM_ENDPOINT_HEADER]: currentEndpoint,
      "x-control-room-a2ui-enabled": a2uiEnabled ? "true" : "false",
    }),
    [a2uiEnabled, currentEndpoint],
  );

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      headers={runtimeHeaders}
      a2ui={
        a2uiEnabled
          ? { catalog: controlRoomA2UICatalog }
          : { includeSchema: false }
      }
      openGenerativeUI={openGenerativeUIEnabled ? {} : undefined}
    >
      {/*
        Broadcasts the active Intelligence thread to the whole cockpit:
        CopilotChat resolves it as its threadId and every useAgent-based
        evidence panel follows the same per-thread agent clone.
      */}
      <CopilotChatConfigurationProvider
        agentId={CONTROL_ROOM_AGENT_NAME}
        threadId={activeThreadId}
      >
        <ControlRoomProvider
          currentEndpoint={currentEndpoint}
          setCurrentEndpoint={setCurrentEndpoint}
          a2uiEnabled={a2uiEnabled}
          setA2UIEnabled={setA2UIEnabled}
          openGenerativeUIEnabled={openGenerativeUIEnabled}
          setOpenGenerativeUIEnabled={setOpenGenerativeUIEnabled}
          activeThreadId={activeThreadId}
          setActiveThreadId={setActiveThreadId}
          chatSessionKey={chatSessionKey}
          startFreshThread={startFreshThread}
        >
          <GenerativeUICatalogProvider>
            <ToolRendererRegistry />
            <GenerativeUIRegistry />
            <TooltipProvider>
              <ControlRoomSuggestions />
              <ThreePaneLayout />
            </TooltipProvider>
          </GenerativeUICatalogProvider>
        </ControlRoomProvider>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

function ThreePaneLayout() {
  return (
    <div className="cockpit-shell flex h-[100dvh] flex-col p-3 md:p-4">
      <ShowcaseDrawer />
      <div className="pointer-events-none absolute right-5 top-5 z-20">
        <div className="pointer-events-auto">
          <HarnessSettingsDialog />
        </div>
      </div>
      <div className="cr-mobile-layout grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
        <Pane className="cr-chat-panel">
          <CenterWorkstream />
        </Pane>
      </div>
      <ResizablePanelGroup
        id="control-room-desktop-layout"
        orientation="horizontal"
        className="cr-desktop-layout min-h-0 flex-1"
      >
        <ResizablePanel
          id="control-room-showcase-sidebar"
          defaultSize="26%"
          minSize="320px"
          maxSize="640px"
        >
          <Pane className="h-full">
            <ShowcaseSidebarFrame />
          </Pane>
        </ResizablePanel>
        <ResizableHandle
          id="control-room-sidebar-resize"
          className="w-2 shrink-0 border-0 bg-transparent transition-colors after:bg-transparent hover:bg-primary/5 hover:after:bg-transparent focus-visible:bg-primary/10"
        />
        <ResizablePanel
          id="control-room-chat-panel"
          defaultSize="74%"
          minSize="520px"
        >
          <Pane className="cr-chat-panel h-full">
            <CenterWorkstream />
          </Pane>
        </ResizablePanel>
      </ResizablePanelGroup>
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
        className="cr-mobile-only absolute left-3 top-3 z-10 rounded-2xl bg-background/95 shadow-sm backdrop-blur"
      >
        <PanelLeft className="text-primary" />
      </Button>
      <SheetContent
        side="left"
        className="w-[80vw] max-w-[80vw] overflow-hidden p-0 data-[side=left]:w-[80vw] sm:w-[560px] sm:max-w-[560px] data-[side=left]:sm:w-[560px] data-[side=left]:sm:max-w-[560px]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>CopilotKit and Microsoft workspace demo</SheetTitle>
          <SheetDescription>
            Harness reads, plans, approves, runs, and renders workspace UI.
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
