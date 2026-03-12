import { useState, useEffect, useCallback } from "react";
import type { TicketMeta } from "../lib/ticket-types";
import { CopilotKitProvider, CopilotChatView } from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/client";

import "@copilotkit/react-core/v2/styles.css";

export const meta: TicketMeta = {
  title: "Welcome screen shows during chat history loading instead of a loader",
  refs: [
    "https://teams.cloud.microsoft.com/l/message/19:K01GstiKjYf6zG4p9pal3Gcyk16LFR3PhWKRQb-iGek1@thread.tacv2/1771433553501?tenantId=c3050389-57ad-4c62-8dcd-fe5e2af4fbce&groupId=7325ddc0-1ada-41be-bf1c-9b944ec69103&parentMessageId=1771433553501&teamName=CopilotKit%20-%20S%26P%20Global&channelName=CopilotKit-%20SP%20Global&createdTime=1771433553501",
  ],
  notes: `
Issue: During chat history loading (connectAgent()), users see the welcome screen
("How can I help you today?") which suggests the chat is new. The send button is
also disabled. Once connect resolves and messages populate, the welcome screen
disappears — but the flash is confusing.

Root cause (CopilotChatView.tsx:203-207):
  const isEmpty = messages.length === 0;
  const shouldShowWelcomeScreen = isEmpty && !welcomeScreenDisabled;
No distinction between "still loading" and "genuinely empty (new chat)".

Workaround using existing API:
  The consumer knows whether they passed a threadId (resuming existing chat) or not
  (new chat). Use this as the signal:
  - threadId provided → welcomeScreen={SpinnerComponent} (shows spinner while messages=[],
    auto-hides when messages populate)
  - no threadId → welcomeScreen={true} (show welcome screen immediately, it's genuinely new)

  Edge case: threadId pointing to a thread with zero messages → spinner stays.
  Could be mitigated with a timeout or by checking runtimeConnectionStatus via
  useCopilotKit().copilotkit.runtimeConnectionStatus (internal API).

Longer-term: CopilotKit could handle this natively by using the threadId prop
as a heuristic inside CopilotChat — if threadId was explicitly provided, seed
isConnecting=true and suppress the welcome screen until connectAgent() resolves.
`.trim(),
};

// ---------------------------------------------------------------------------
// Simulated history — pretend these come back from connectAgent()
// ---------------------------------------------------------------------------
const FAKE_HISTORY: Message[] = [
  { id: "h1", role: "user", content: "What's the status of project Alpha?" },
  {
    id: "h2",
    role: "assistant",
    content:
      "Project Alpha is on track. The frontend team completed the dashboard redesign last week, and the backend migration is at 85% completion.",
  },
  { id: "h3", role: "user", content: "Any blockers on the backend migration?" },
  {
    id: "h4",
    role: "assistant",
    content:
      "There's one blocker: the legacy payment gateway integration needs a manual schema migration. The team estimates 2 days of work. Everything else is proceeding smoothly.",
  },
];

const CONNECT_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Shared hook: simulates connectAgent() resolving after a delay
// ---------------------------------------------------------------------------
function useSimulatedConnect(historyResult: Message[]) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    console.log(
      "[tkt-welcome-screen-loading] connectAgent() started, will resolve with",
      historyResult.length,
      "messages in",
      CONNECT_DELAY_MS,
      "ms",
    );
    const timer = setTimeout(() => {
      console.log(
        "[tkt-welcome-screen-loading] connectAgent() resolved —",
        historyResult.length,
        "messages",
      );
      setMessages(historyResult);
      setIsConnecting(false);
    }, CONNECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { messages, isConnecting };
}

// ---------------------------------------------------------------------------
// Stable loading spinner component for the welcomeScreen slot.
// Defined outside of render so the reference is stable (avoids slot system
// re-mount issues with inline arrow functions).
// ---------------------------------------------------------------------------
function LoadingWelcomeScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-3 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      <p className="text-sm text-gray-500">Loading chat history...</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bug demo: no threadId awareness — welcome screen always shows when empty
// ---------------------------------------------------------------------------
function BugDemo({ hasHistory }: { hasHistory: boolean }) {
  const { messages, isConnecting } = useSimulatedConnect(hasHistory ? FAKE_HISTORY : []);

  console.log(
    "[tkt-welcome-screen-loading] BugDemo —",
    "messages:",
    messages.length,
    "isConnecting:",
    isConnecting,
    "hasHistory:",
    hasHistory,
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
        <strong>Bug:</strong>{" "}
        {isConnecting
          ? "Connecting... welcome screen visible below (misleading)"
          : hasHistory
            ? "Connected — messages loaded, but welcome screen flashed during load"
            : "Connected — welcome screen showing (correct, but was indistinguishable from loading)"}
      </div>
      <div className="flex-1 min-h-0">
        <CopilotChatView messages={messages} isRunning={isConnecting} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workaround demo: use threadId as the signal to control welcomeScreen
//
// - threadId provided (existing chat) → welcomeScreen={LoadingWelcomeScreen}
//   Shows a spinner while messages=[]. When messages populate, CopilotChatView
//   switches to the message list automatically (isEmpty becomes false).
//
// - no threadId (new chat) → welcomeScreen={true}
//   Shows the default "How can I help you today?" immediately. No loading
//   ambiguity because there's nothing to load.
// ---------------------------------------------------------------------------
function WorkaroundDemo({ threadId }: { threadId: string | undefined }) {
  const hasHistory = threadId !== undefined;
  const { messages, isConnecting } = useSimulatedConnect(hasHistory ? FAKE_HISTORY : []);

  console.log(
    "[tkt-welcome-screen-loading] WorkaroundDemo —",
    "threadId:",
    threadId ?? "(none)",
    "messages:",
    messages.length,
    "isConnecting:",
    isConnecting,
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 bg-green-50 border-b border-green-200 text-sm text-green-700">
        <strong>Workaround:</strong>{" "}
        {threadId
          ? isConnecting
            ? "threadId provided → spinner shown while loading history"
            : "Connected — messages loaded, no welcome screen flash"
          : "No threadId → welcome screen shown immediately (genuinely new chat)"}
      </div>
      <div className="flex-1 min-h-0">
        <CopilotChatView
          messages={messages}
          isRunning={isConnecting}
          welcomeScreen={threadId ? LoadingWelcomeScreen : true}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
type DemoId = "bug-history" | "bug-new" | "fix-history" | "fix-new";

const DEMOS: { id: DemoId; label: string; group: "bug" | "fix" }[] = [
  { id: "bug-history", label: "Existing chat", group: "bug" },
  { id: "bug-new", label: "New chat", group: "bug" },
  { id: "fix-history", label: "Existing chat (threadId)", group: "fix" },
  { id: "fix-new", label: "New chat (no threadId)", group: "fix" },
];

export default function TktWelcomeScreenLoading() {
  const [activeDemo, setActiveDemo] = useState<DemoId>("bug-history");
  const [demoKey, setDemoKey] = useState(0);

  console.log("[tkt-welcome-screen-loading] Main mounted, activeDemo:", activeDemo);

  const switchDemo = useCallback((id: DemoId) => {
    console.log("[tkt-welcome-screen-loading] Switching to:", id);
    setActiveDemo(id);
    setDemoKey((k) => k + 1);
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold mb-2">Welcome Screen During History Loading</h2>
      <p className="text-sm text-gray-600 mb-4">
        When <code className="bg-gray-100 px-1 rounded">CopilotChat</code> mounts, it calls{" "}
        <code className="bg-gray-100 px-1 rounded">connectAgent()</code> to restore history.{" "}
        <code className="bg-gray-100 px-1 rounded">messages</code> starts as{" "}
        <code className="bg-gray-100 px-1 rounded">[]</code>, so the welcome screen renders — even
        if the thread has existing history. Each demo simulates a {CONNECT_DELAY_MS / 1000}s connect
        delay.
      </p>

      {/* Demo selector */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-red-600 w-20">Current:</span>
          {DEMOS.filter((d) => d.group === "bug").map((d) => (
            <button
              key={d.id}
              onClick={() => switchDemo(d.id)}
              className={`px-3 py-1.5 text-sm rounded border cursor-pointer ${
                activeDemo === d.id
                  ? "bg-red-100 border-red-300 text-red-700"
                  : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-green-600 w-20">Workaround:</span>
          {DEMOS.filter((d) => d.group === "fix").map((d) => (
            <button
              key={d.id}
              onClick={() => switchDemo(d.id)}
              className={`px-3 py-1.5 text-sm rounded border cursor-pointer ${
                activeDemo === d.id
                  ? "bg-green-100 border-green-300 text-green-700"
                  : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active demo */}
      <CopilotKitProvider>
        <div className="border rounded-lg overflow-hidden h-[500px]" key={demoKey}>
          {activeDemo === "bug-history" && <BugDemo hasHistory={true} />}
          {activeDemo === "bug-new" && <BugDemo hasHistory={false} />}
          {activeDemo === "fix-history" && <WorkaroundDemo threadId="existing-thread-abc" />}
          {activeDemo === "fix-new" && <WorkaroundDemo threadId={undefined} />}
        </div>
      </CopilotKitProvider>

      {/* Explanation */}
      <div className="mt-6 space-y-4">
        <h3 className="font-semibold text-sm">How the workaround works</h3>
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            The consumer knows whether they're resuming an existing chat (they passed a{" "}
            <code className="bg-gray-100 px-1 rounded text-xs">threadId</code>) or starting a new
            one (no <code className="bg-gray-100 px-1 rounded text-xs">threadId</code>). Use this to
            control the <code className="bg-gray-100 px-1 rounded text-xs">welcomeScreen</code>{" "}
            prop:
          </p>
          <pre className="bg-gray-50 p-4 rounded text-xs overflow-x-auto border leading-relaxed">
            {`<CopilotChat
  threadId={existingThreadId}
  welcomeScreen={existingThreadId ? LoadingSpinner : true}
/>`}
          </pre>
          <ul className="list-disc ml-5 space-y-1 text-gray-600">
            <li>
              <strong>threadId provided:</strong> The custom{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">LoadingSpinner</code> renders via
              the welcomeScreen slot while{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">messages=[]</code>. Once{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">connectAgent()</code> resolves and
              messages populate,{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">CopilotChatView</code>{" "}
              automatically switches to the message list (
              <code className="bg-gray-100 px-1 rounded text-xs">isEmpty</code> becomes false).
            </li>
            <li>
              <strong>No threadId:</strong> Default welcome screen shows immediately — no ambiguity,
              it's genuinely a new chat.
            </li>
          </ul>
        </div>

        <h3 className="font-semibold text-sm">Edge case</h3>
        <p className="text-sm text-gray-600">
          If a <code className="bg-gray-100 px-1 rounded text-xs">threadId</code> points to a thread
          with zero messages, the spinner stays (
          <code className="bg-gray-100 px-1 rounded text-xs">isEmpty</code> never becomes false).
          Could be mitigated with a timeout, or CopilotKit could expose the connect completion state
          — internally{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">
            CopilotKitCore.runtimeConnectionStatus
          </code>{" "}
          already tracks this but isn't surfaced to the chat UI.
        </p>

        <h3 className="font-semibold text-sm">Longer-term: built-in fix</h3>
        <p className="text-sm text-gray-600">
          CopilotKit could handle this natively inside{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">CopilotChat</code>: if a{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">threadId</code> prop was explicitly
          provided, seed <code className="bg-gray-100 px-1 rounded text-xs">isConnecting=true</code>{" "}
          and pass it to <code className="bg-gray-100 px-1 rounded text-xs">CopilotChatView</code>,
          which would show a loading screen instead of the welcome screen until{" "}
          <code className="bg-gray-100 px-1 rounded text-xs">connectAgent()</code> resolves.
        </p>
      </div>
    </div>
  );
}
