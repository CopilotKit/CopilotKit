"use client";

import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { playgroundUI } from "@/a2ui/catalog/catalog";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { useDesignSystem } from "@/design-systems/context";
import { HOST_CLASS } from "@/design-systems/registry";
import { DESIGN_SYSTEM_THEMES } from "@/design-systems/themes";
import { cn } from "@/lib/utils";
import { surfaceIdOf } from "@/lib/run-store";
import type { A2UIOp } from "@/lib/run-store";
import { useBaseSurfaceRenderer } from "./surface-renderer";

/** Static surfaces have no agent behind them; the provider still needs one to start. */
class NoAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}
const AGENTS = { default: new NoAgent() };

/**
 * A Gen UI 2.0 provider with no runtime, for pages that show surfaces without
 * a chat (catalog previews, the landing replay, recorded runs). Mounted once
 * in the root layout; the playground nests its own provider inside it. Under
 * a design system (the playground's JSON preview) it takes that theme, so the
 * swapped components and the standard ones agree.
 */
export function StaticGenUIProvider({ children }: { children: ReactNode }) {
  const { id } = useDesignSystem();
  const generativeUI = useMemo(
    () => ({ ui: playgroundUI, theme: DESIGN_SYSTEM_THEMES[id] }),
    [id],
  );
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={AGENTS}
      generativeUI={generativeUI}
      enableInspector={false}
      showDevConsole={false}
    >
      {children}
    </CopilotKitProvider>
  );
}

/**
 * Renders a list of A2UI 1.0 operations outside the chat, with the same
 * engine and the same validation the chat uses. Each instance is its own
 * thread, so its surface id never collides with another surface on the page.
 * Re-feeding a grown op list (streaming) only applies what is new.
 */
export function StaticSurface({
  ops,
  className,
}: {
  ops: A2UIOp[];
  className?: string;
}) {
  const runtime = useGenerativeUIRuntime();
  const body = <Body ops={ops} className={className} />;
  return runtime ? body : <StaticGenUIProvider>{body}</StaticGenUIProvider>;
}

function Body({ ops, className }: { ops: A2UIOp[]; className?: string }) {
  const threadId = `static-${useId()}`;
  const Base = useBaseSurfaceRenderer();
  const surfaceId = useMemo(() => surfaceIdOf(ops), [ops]);
  const content = useMemo<GenerativeUISurfaceContent>(
    () => ({
      surfaceId,
      target: GENERATIVE_UI_CHAT_TARGET,
      catalogId: CATALOG_ID,
      operations: ops as unknown as A2UIOperation[],
      status: "ready",
      rejected: [],
    }),
    [ops, surfaceId],
  );
  const message = useMemo(
    () => ({
      id: `static:${surfaceId}`,
      role: "activity" as const,
      activityType: GENERATIVE_UI_ACTIVITY_TYPE,
      content: content as unknown as Record<string, unknown>,
    }),
    [content, surfaceId],
  );
  const ds = useDesignSystem().id;
  if (!Base) return null;
  return (
    <div className={cn("a2-static", HOST_CLASS[ds], className)} data-ds={ds}>
      <CopilotChatConfigurationProvider threadId={threadId}>
        <Base
          activityType={GENERATIVE_UI_ACTIVITY_TYPE}
          content={content}
          message={message}
          agent={undefined}
        />
      </CopilotChatConfigurationProvider>
    </div>
  );
}
