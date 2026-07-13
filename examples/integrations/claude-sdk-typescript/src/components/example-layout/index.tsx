"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ModeToggle } from "./mode-toggle";
import { useFrontendTool } from "@copilotkit/react-core/v2";

interface ExampleLayoutProps {
  chatContent: ReactNode;
  appContent: ReactNode;
}

export function ExampleLayout({ chatContent, appContent }: ExampleLayoutProps) {
  const [mode, setMode] = useState<"chat" | "app">("chat");

  useFrontendTool({
    name: "enableAppMode",
    description:
      "Enable app mode, make sure its open when interacting with todos.",
    handler: async () => {
      setMode("app");
    },
  });

  useFrontendTool({
    name: "enableChatMode",
    description: "Enable chat mode",
    handler: async () => {
      setMode("chat");
    },
  });

  return (
    <div className="h-full flex flex-row pb-6">
      <ModeToggle mode={mode} onModeChange={setMode} />

      {/* Chat Content */}
      <div
        className={`max-h-full flex flex-col dark:bg-stone-950 ${
          mode === "app"
            ? "w-1/2 px-6 max-lg:hidden" // Half/half with the canvas; hidden on mobile in app mode
            : "flex-1 max-lg:px-4"
        }`}
      >
        {/* Clear the threads drawer's floating launcher/collapsed cluster, which
            is fixed at the top-left corner. Below 1024px (mobile off-canvas) that
            is always present → max-lg:pl-24. On desktop it only appears when the
            drawer is COLLAPSED — detected via --cpk-drawer-reserved-width, which
            the drawer sets to 0px on collapse (else its 320px default): the pl
            calc resolves to 1.5rem (pl-6) when expanded and ~6rem when collapsed,
            so the logo never sits under the cluster. max-lg:pt-2.5 + pb-0
            vertically center the logo with that launcher and the top-right
            Chat/App toggle (both pinned at top-2). */}
        <div className="shrink-0 pt-[23px] pl-[max(1.5rem,calc(7rem_-_var(--cpk-drawer-reserved-width,320px)))] pb-2 max-lg:pl-24 max-lg:pb-4 flex gap-1.5 items-center align-center">
          <span className="font-extrabold text-2xl">CopilotKit</span>
          <img
            src="/copilotkit-logo-mark.svg"
            alt="CopilotKit"
            className="h-7"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{chatContent}</div>
      </div>

      {/* State Panel */}
      <div
        className={`h-full overflow-hidden ${
          mode === "app"
            ? "w-1/2 max-lg:w-full border-l border-[var(--border)] max-lg:border-l-0" // Half/half with the chat; full width on mobile
            : "w-0 border-l-0"
        }`}
      >
        {/*
          Fill the state panel's own width. The previous `lg:w-[66.666vw]` was
          viewport-relative, so with a reserved drawer column it overflowed this
          container (clipped by overflow-hidden) and pushed centered content
          right of the visible box's center.
        */}
        <div className="w-full h-full">{appContent}</div>
      </div>
    </div>
  );
}
