import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotChatView,
  CopilotKitProvider,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useCopilotChatConfiguration,
  useThreads,
} from "@copilotkit/react-core/v2";
import type { CopilotChatViewProps } from "@copilotkit/react-core/v2";
import { useAuth } from "@clerk/tanstack-react-start";
import { LayoutGrid, PanelLeftOpen, Plug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AGENT_ID } from "../lib/agent";
import type { DeskAgentState } from "../lib/agent";
import { ConnectionsProvider } from "../lib/connections";
import { DeskProvider } from "../lib/desk-store";
import { deskTheme, deskUI } from "../lib/generative-ui";
import { DEFAULT_MODEL, isModelId } from "../lib/models";
import type { ModelId } from "../lib/models";
import { DISCLAIMER, STARTERS } from "../lib/starters";
import { ThreadIcon } from "../lib/thread-icons";
import { useStagePage } from "../lib/use-stage-page";
import type { StagePage } from "../lib/use-stage-page";
import { useDeskFunctions } from "../lib/use-desk-functions";
import { useDrawer } from "../lib/use-drawer";
import { useStoredState } from "../lib/use-stored-state";
import { useThreadIcons } from "../lib/use-thread-icons";
import { useThreadInUrl } from "../lib/use-thread-in-url";
import { useViewRequestMessages } from "../lib/use-view-request-messages";
import { useActionConfirmation } from "./ActionConfirmation";
import { CatalogPage } from "./CatalogPage";
import { ConnectionsPage } from "./ConnectionsPage";
import { Composer } from "./Composer";
import { useMessageView } from "./Messages";
import { ReportPanel } from "./ReportPanel";
import { useResearchSteps } from "./ResearchStep";
import { StatusLine } from "./StatusLine";
import { ThreadDrawer } from "./ThreadDrawer";
import { StarterSuggestions, Welcome } from "./Welcome";
import { SurfaceFrame } from "./SurfaceFrame";

/**
 * The generative UI: the standard catalog plus the desk's functions, in the
 * desk's theme.
 *
 * Markdown transport: the agent writes A2UI in ```a2ui fences inside its
 * reply, and views build up component by component as the reply streams.
 * Gemini writes this JSON reliably as text; as function-call arguments it
 * garbles large nested objects.
 *
 * A part the agent got wrong is left out of the view rather than shown as an
 * error box; its operation still shows in the view's A2UI.
 */
const GENERATIVE_UI = {
  ui: deskUI,
  theme: deskTheme,
  transport: "markdown" as const,
  errorBoundary: { fallback: () => null },
};

/** Pictures the reader can attach from the + menu or by dropping them. */
const ATTACHMENTS = {
  enabled: true,
  accept: "image/png,image/jpeg,image/webp,image/gif",
  maxSize: 8 * 1024 * 1024,
};

/**
 * CopilotChat's view, marked while files are dragged over it, so the composer
 * can show that it is where a dropped picture goes. CopilotChat takes the
 * drop anywhere in its view.
 */
function DeskChatView(props: CopilotChatViewProps) {
  const submitWithView = useViewRequestMessages();
  return (
    <CopilotChatView
      {...props}
      data-drag-over={props.dragOver || undefined}
      onSubmitMessage={
        props.onSubmitMessage
          ? (value) => submitWithView(() => props.onSubmitMessage!(value))
          : undefined
      }
      onSelectSuggestion={
        props.onSelectSuggestion
          ? (suggestion, index) =>
              submitWithView(() => props.onSelectSuggestion!(suggestion, index))
          : undefined
      }
    />
  );
}

const MODEL_KEY = "research-desk:model";

export function Desk() {
  const [model, setModel] = useStoredState<ModelId>(
    MODEL_KEY,
    DEFAULT_MODEL,
    isModelId,
  );
  // The ADK agent reads `forwardedProps.model` on every run.
  const properties = useMemo(() => ({ model }), [model]);
  // The CopilotKit Inspector (with its Generative UI pane) stays out of demos
  // unless the URL asks for it: http://localhost:3014/?inspector
  const [inspector, setInspector] = useState(false);
  useEffect(
    () =>
      setInspector(
        new URLSearchParams(window.location.search).has("inspector"),
      ),
    [],
  );

  // Signed in, the runtime keeps threads (Intelligence); signed out, the
  // default, nothing is kept. The provider remounts when that changes, so it always talks to
  // the runtime that matches.
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="desk-loading" aria-hidden />;

  return (
    <CopilotKitProvider
      key={isSignedIn ? "signed-in" : "signed-out"}
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      properties={properties}
      generativeUI={GENERATIVE_UI}
      enableInspector={inspector}
    >
      <DeskProvider>
        <CopilotChatConfigurationProvider agentId={AGENT_ID}>
          <ConnectionsProvider signedIn={Boolean(isSignedIn)}>
            <Shell
              model={model}
              onModelChange={setModel}
              signedIn={Boolean(isSignedIn)}
            />
          </ConnectionsProvider>
        </CopilotChatConfigurationProvider>
      </DeskProvider>
    </CopilotKitProvider>
  );
}

/** Threads on the left, the chat in the middle, the report on the right. */
function Shell({
  model,
  onModelChange,
  signedIn,
}: {
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  /** Signed out (the default), nothing is kept: no threads, no apps. */
  signedIn: boolean;
}) {
  useDeskFunctions();
  useResearchSteps();
  useActionConfirmation();
  // The agent works out the reader's date and time from this on every call
  // (agent/src/research_desk/clock.py).
  useAgentContext({
    description: "The reader's time zone",
    value: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const threadId = useCopilotChatConfiguration()?.threadId;
  // Passing the thread id reloads the starters on every new thread, so they
  // are back each time the reader starts a new question.
  useConfigureSuggestions(
    {
      available: "before-first-message",
      suggestions: STARTERS.map(({ title, message }) => ({ title, message })),
    },
    [threadId],
  );

  const drawer = useDrawer();
  // The stage shows the chat, or a page (the catalog, the reader's
  // connected apps) in its place. The chat stays mounted under a page, so a
  // run keeps streaming.
  const [page, setPage] = useStagePage();
  const onPage = page !== "chat";
  const messageView = useMessageView();
  const threadsState = useThreads({
    agentId: AGENT_ID,
    limit: 40,
    enabled: signedIn,
  });
  const activeThread = threadsState.threads.find(
    (thread) => thread.id === threadId,
  );
  useThreadInUrl(Boolean(activeThread), threadsState.isLoading);

  // The agent picks an icon for each thread; the open one arrives live in
  // the agent's state, the rest from each thread's stored state.
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const liveIcon = (agent.state as DeskAgentState | undefined)?.icon;
  const icons = useThreadIcons(
    threadsState.threads,
    threadId ? { threadId, icon: liveIcon } : undefined,
  );

  return (
    <div className="desk" data-drawer={drawer.open ? "open" : "closed"}>
      {/* The welcome screen brings its own h1; a thread view needs one. */}
      {(activeThread || onPage) && (
        <h1 className="visually-hidden">A2UI Playground</h1>
      )}
      {drawer.open && (
        <ThreadDrawer
          threads={threadsState}
          signedIn={signedIn}
          icons={icons}
          onCollapse={() => drawer.setOpen(false)}
          onNavigate={() => {
            setPage("chat");
            if (drawer.narrow) drawer.setOpen(false);
          }}
          newQuestionRef={drawer.newQuestionRef}
          page={page}
          onOpenPage={(next: StagePage) => {
            setPage(next);
            if (drawer.narrow) drawer.setOpen(false);
          }}
        />
      )}
      {drawer.narrow && drawer.open && (
        <button
          type="button"
          className="scrim"
          aria-label="Close threads"
          onClick={() => drawer.setOpen(false)}
        />
      )}
      <main
        className="stage"
        inert={drawer.narrow && drawer.open ? true : undefined}
      >
        <header className="stage__head">
          {!drawer.open && (
            <button
              ref={drawer.toggleRef}
              type="button"
              className="icon-button stage__drawer-toggle"
              onClick={() => drawer.setOpen(true)}
              aria-label="Show threads"
              title="Show threads"
            >
              <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {page === "catalog" ? (
            <div className="stage__title">
              <LayoutGrid size={17} strokeWidth={1.75} aria-hidden />
              <h2>Catalog</h2>
            </div>
          ) : page === "connections" ? (
            <div className="stage__title">
              <Plug size={17} strokeWidth={1.75} aria-hidden />
              <h2>Connections</h2>
            </div>
          ) : (
            activeThread && (
              <div className="stage__title">
                <ThreadIcon name={icons[activeThread.id]} size={17} />
                <h2>{activeThread.name ?? "Untitled question"}</h2>
              </div>
            )
          )}
        </header>
        {page === "catalog" && <CatalogPage />}
        {page === "connections" && <ConnectionsPage />}
        <CopilotChat
          agentId={AGENT_ID}
          className={onPage ? "chat chat--away" : "chat"}
          chatView={DeskChatView}
          // The question the reader just sent stays at the top while the
          // answer writes itself in below it.
          autoScroll="pin-to-send"
          messageView={messageView}
          generativeUISurface={SurfaceFrame}
          welcomeScreen={Welcome}
          suggestionView={StarterSuggestions}
          attachments={ATTACHMENTS}
          input={{
            textArea: "composer__textarea",
            sendButton: "composer__send",
            children: (parts) => (
              <Composer
                parts={parts}
                model={model}
                onModelChange={onModelChange}
              />
            ),
          }}
          scrollView={{ scrollToBottomButton: "desk-scroll-bottom" }}
          labels={{
            chatInputPlaceholder: "Ask about anything…",
            chatDisclaimerText: DISCLAIMER,
          }}
        />
        <StatusLine />
      </main>
      <ReportPanel />
    </div>
  );
}
