"use client";

import { useId, useMemo, type ReactNode } from "react";
import { AbstractAgent, type BaseEvent } from "@ag-ui/client";
import {
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CHAT_TARGET,
  type A2UIOperation,
  type GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { EMPTY, type Observable } from "rxjs";
import { playgroundTheme, playgroundUI } from "@/a2ui/catalog/catalog"; // your createGenerativeUI(...) result
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { useBaseSurfaceRenderer } from "./surface-mirror";

type A2UIOp = Record<string, unknown>;
const surfaceIdOf = (ops: A2UIOp[]) => {
  for (const op of ops)
    for (const k of [
      "createSurface",
      "updateComponents",
      "updateDataModel",
      "deleteSurface",
    ]) {
      const sid = (op[k] as { surfaceId?: string } | undefined)?.surfaceId;
      if (sid) return sid;
    }
  return "surface";
};

const GENERATIVE_UI = { ui: playgroundUI, theme: playgroundTheme };

/** Static surfaces have no agent behind them; the provider still needs one to start. */
class NoAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}
const AGENTS = { default: new NoAgent() };

/**
 * A Gen UI 2.0 provider with no runtime, for pages that show surfaces without
 * a chat (catalog previews, a landing replay, recorded runs). Mount it once
 * in the root layout; a chat page nests its own provider inside it.
 */
export function StaticGenUIProvider({ children }: { children: ReactNode }) {
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={AGENTS}
      generativeUI={GENERATIVE_UI}
      enableInspector={false}
      showDevConsole={false}
    >
      {children}
    </CopilotKitProvider>
  );
}

/**
 * Renders a list of A2UI v1.0 operations outside the chat, with the same
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
  if (!Base) return null;
  return (
    <div className={["a2-static", className].filter(Boolean).join(" ")}>
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
