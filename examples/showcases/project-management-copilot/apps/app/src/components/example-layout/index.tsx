"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ModeToggle } from "./mode-toggle";
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export type ExampleLayoutMode = "chat" | "app";

interface ExampleLayoutProps {
  chatContent: ReactNode;
  appContent: ReactNode;
  chatHeader?: ReactNode;
  /**
   * Controlled mode. When provided, `mode` lives in the parent (HomePage)
   * so external actions — e.g. clicking "New thread" — can flip the layout
   * back to chat-only. Falls back to internal state for callers that
   * don't care.
   */
  mode?: ExampleLayoutMode;
  onModeChange?: (mode: ExampleLayoutMode) => void;
}

export function ExampleLayout({
  chatContent,
  appContent,
  chatHeader,
  mode: controlledMode,
  onModeChange,
}: ExampleLayoutProps) {
  const [uncontrolledMode, setUncontrolledMode] =
    useState<ExampleLayoutMode>("app");
  const mode = controlledMode ?? uncontrolledMode;
  const setMode = (next: ExampleLayoutMode) => {
    if (controlledMode === undefined) setUncontrolledMode(next);
    onModeChange?.(next);
  };
  // Nonce-keyed remount counter. Bumping this re-mounts the board panel
  // (and therefore IssueBoard), which resets IssueBoard's "seen ids" ref so
  // the staggered entrance animation plays for every card again. Used by
  // the sprint-planning demo to make the board feel like it's "opening"
  // with the new cycle even when the user was already in app mode.
  const [appModeNonce, setAppModeNonce] = useState(0);

  // Auto-hide scrollbars inside the chat panel 1s after the last scroll
  // event. CopilotChat creates its own internal scroll container for the
  // message list, so we listen in capture phase on the panel and tag the
  // actual scrolling target — `scroll` events don't bubble, but they do
  // reach capture-phase listeners on ancestors.
  const chatPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = chatPanelRef.current;
    if (!panel) return;
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
    const onScroll = (e: Event) => {
      const target = e.target as Element | null;
      if (!target || !("classList" in target)) return;
      target.classList.add("is-scrolling");
      const prev = timers.get(target);
      if (prev) clearTimeout(prev);
      timers.set(
        target,
        setTimeout(() => target.classList.remove("is-scrolling"), 1000),
      );
    };
    panel.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    return () => {
      panel.removeEventListener("scroll", onScroll, {
        capture: true,
      } as EventListenerOptions);
    };
  }, []);

  // ExampleLayout previously imported useFrontendTool from
  // @copilotkit/react-core (v1) while the rest of the app uses v2. v1
  // registrations don't reach v2's per-agent tool registry, so fixture
  // calls to enableAppMode were silently dropped in mock mode. Port both
  // tools to v2 + give enableAppMode a nonce bump so it always re-triggers
  // the board entrance animation, not just when transitioning chat -> app.
  useFrontendTool({
    name: "enableAppMode",
    description:
      "Open the kanban board (app mode) and replay the staggered card entrance animation. Call this whenever the user wants to see, edit, or talk about issues, or to draw attention to a board change you just made.",
    parameters: z.object({}),
    handler: async () => {
      setMode("app");
      setAppModeNonce((n) => n + 1);
    },
  });

  useFrontendTool({
    name: "enableChatMode",
    description: "Close the kanban board and focus on chat.",
    parameters: z.object({}),
    handler: async () => {
      setMode("chat");
    },
  });

  return (
    <div
      className="h-full flex flex-row"
      style={{ height: "calc(100dvh - 16px)" }}
    >
      <ModeToggle mode={mode} onModeChange={setMode} />

      {/* Chat panel — glass card */}
      <div
        ref={chatPanelRef}
        className={`chat-panel max-h-full flex flex-col ${
          mode === "app" ? "w-[420px] max-lg:hidden" : "flex-1"
        }`}
        style={{
          background: "rgba(255, 255, 255, 0.5)",
          border: "2px solid #ffffff",
          borderRadius: 8,
          marginRight: 8,
          overflow: "hidden",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div className="shrink-0 pt-5 pl-5 pr-4 pb-2 max-lg:pl-4 max-lg:pt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/copilotkit-logo.svg" alt="CopilotKit" className="h-6" />
            <span
              style={{
                fontSize: 18,
                fontWeight: 300,
                color: "var(--text-primary)",
                marginLeft: 4,
              }}
            >
              PM Copilot
            </span>
          </div>
          {chatHeader}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {chatContent}
        </div>
      </div>

      {/* Board panel */}
      {mode === "app" && (
        <div
          key={appModeNonce}
          className="h-full overflow-hidden flex-1 max-lg:w-full"
          style={{
            background: "rgba(255, 255, 255, 0.4)",
            border: "2px solid #ffffff",
            borderRadius: 8,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div className="w-full h-full">{appContent}</div>
        </div>
      )}
    </div>
  );
}
