import { useEffect, useState } from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  CopilotKitCoreErrorCode,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
// react-core/v2 re-exports the core types, so the example needs no direct
// dependency on @copilotkit/core.
import type { CopilotKitCoreFriendsAccess } from "@copilotkit/react-core/v2";
import { z } from "zod";
import "@copilotkit/react-core/v2/styles.css";

type AgentType = "tanstack" | "aisdk";

const HEALTHY_RUNTIME_URL = "/api/copilotkit";
const DEAD_RUNTIME_URL = "/api/nope";

const toolbarButtonClass = (active: boolean) =>
  `px-3 py-1 text-sm rounded-md transition-colors ${
    active
      ? "bg-black text-white dark:bg-neutral-50 dark:text-neutral-900"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
  }`;

const FAIL_THREADS_COOKIE = "cpk_lab_fail_threads";
const FAIL_MEMORIES_COOKIE = "cpk_lab_fail_memories";

function setFailThreadsCookie(fail: boolean) {
  document.cookie = fail
    ? `${FAIL_THREADS_COOKIE}=1; Path=/`
    : `${FAIL_THREADS_COOKIE}=; Path=/; Max-Age=0`;
}

function setFailMemoriesCookie(fail: boolean) {
  document.cookie = fail
    ? `${FAIL_MEMORIES_COOKIE}=1; Path=/`
    : `${FAIL_MEMORIES_COOKIE}=; Path=/; Max-Age=0`;
}

if (typeof document !== "undefined") {
  // Clear before React mounts. Inspector fetches /threads during setup, so
  // a leftover cookie from "Break threads" would fail the first list call.
  setFailThreadsCookie(false);
  setFailMemoriesCookie(false);
}

/**
 * Local lab for inspector error signals.
 * Break runtime points the core at a dead /info route.
 * Break threads makes the list route return 503 while the connection stays up.
 * Break learning makes the memory list route return 503. Visit Learning once
 * first: its store is intentionally lazy, matching the production Inspector.
 * Chat: send "crash the run" or "crash the tool" for real run/tool failures.
 */
function InspectorErrorLab() {
  const { copilotkit } = useCopilotKit();
  useFrontendTool({
    name: "crash",
    description:
      "Always throws. Call this when the user asks to crash the tool, fail a tool, or test a tool error.",
    parameters: z.object({}),
    handler: async () => {
      throw new Error("Inspector lab: tool handler crashed.");
    },
    render: ({ name, status, result }) => (
      <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
        <div className="font-medium">{name} failed</div>
        <div className="mt-1 text-xs">
          {status === "complete" && result
            ? result
            : "The tool is running and will throw."}
        </div>
      </div>
    ),
  });
  const [threadsBroken, setThreadsBroken] = useState(false);
  const [memoriesBroken, setMemoriesBroken] = useState(false);
  const runtimeBroken = copilotkit.runtimeUrl === DEAD_RUNTIME_URL;

  const refreshThreadStores = () => {
    for (const store of Object.values(copilotkit.getThreadStores())) {
      store.refresh();
    }
  };

  const breakRuntime = () => {
    copilotkit.setRuntimeUrl(DEAD_RUNTIME_URL);
  };

  const breakThreads = () => {
    setFailThreadsCookie(true);
    setThreadsBroken(true);
    refreshThreadStores();
  };

  const fireCoreError = (code: CopilotKitCoreErrorCode, message: string) => {
    void (copilotkit as unknown as CopilotKitCoreFriendsAccess).emitError({
      error: new Error(message),
      code,
      context: { source: "inspector-error-lab" },
    });
  };

  const breakRun = () => {
    fireCoreError(
      CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
      "Inspector lab: the agent run failed.",
    );
  };

  const breakTool = () => {
    fireCoreError(
      CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
      "Inspector lab: tool not found.",
    );
  };

  const breakLearning = () => {
    setFailMemoriesCookie(true);
    setMemoriesBroken(true);
    // The error surface is fed by the real memory-store subscription. Calling
    // refresh is a no-op until Learning has been visited, by design.
    void copilotkit
      .getMemoryStore()
      .refresh()
      .catch(() => {});
  };

  const restore = () => {
    setFailThreadsCookie(false);
    setFailMemoriesCookie(false);
    setThreadsBroken(false);
    setMemoriesBroken(false);
    copilotkit.setRuntimeUrl(HEALTHY_RUNTIME_URL);
    refreshThreadStores();
    void copilotkit
      .getMemoryStore()
      .refresh()
      .catch(() => {});
  };

  useEffect(() => {
    return () => {
      setFailThreadsCookie(false);
      setFailMemoriesCookie(false);
    };
  }, []);

  return (
    <div
      role="group"
      aria-label="Inspector error lab"
      className="flex items-center gap-2 border-l border-gray-200 pl-3 dark:border-neutral-800"
    >
      <span className="text-xs text-gray-500 dark:text-neutral-400">
        Runtime: {copilotkit.runtimeConnectionStatus}
        {threadsBroken ? " · threads broken" : ""}
        {memoriesBroken ? " · learning broken" : ""}
      </span>
      <button
        type="button"
        onClick={breakRuntime}
        className={toolbarButtonClass(runtimeBroken)}
      >
        Break runtime
      </button>
      <button
        type="button"
        onClick={breakThreads}
        className={toolbarButtonClass(threadsBroken)}
      >
        Break threads
      </button>
      <button
        type="button"
        onClick={breakRun}
        className={toolbarButtonClass(false)}
      >
        Break run
      </button>
      <button
        type="button"
        onClick={breakTool}
        className={toolbarButtonClass(false)}
      >
        Break tool
      </button>
      <button
        type="button"
        onClick={breakLearning}
        className={toolbarButtonClass(memoriesBroken)}
        title="Open Inspector > Learning once before triggering this failure."
      >
        Break learning
      </button>
      <button
        type="button"
        onClick={restore}
        className={toolbarButtonClass(false)}
      >
        Restore
      </button>
    </div>
  );
}

export default function Index() {
  const [agentType, setAgentType] = useState<AgentType>("tanstack");
  const [chatError, setChatError] = useState<string | null>(null);
  // Same shape as the react demo's theme toggle: the host application owns the
  // theme, and the `dark` class is what CopilotChat reads to swap its own
  // variables. The colours below are Tailwind's neutral scale, which is where
  // the demo's oklch literals come from -- neutral-950 is oklch(0.145 0 0),
  // neutral-50 is oklch(0.985 0 0), neutral-800 is oklch(0.269 0 0).
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const dark = theme === "dark";

  return (
    <CopilotKitProvider runtimeUrl={HEALTHY_RUNTIME_URL} showDevConsole="auto">
      <div
        className={`h-screen w-screen flex flex-col transition-colors ${
          dark
            ? "dark bg-neutral-950 text-neutral-50"
            : "bg-white text-neutral-900"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            className={toolbarButtonClass(false)}
            aria-pressed={dark}
            aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
            title="Switch the host page between light and dark, the way the react demo does. The launcher floats over customer pages, so both are worth looking at."
          >
            {dark ? "Light" : "Dark"}
          </button>
          <span className="text-sm font-medium text-gray-600 dark:text-neutral-300">
            Agent:
          </span>
          <button
            type="button"
            onClick={() => setAgentType("aisdk")}
            className={toolbarButtonClass(agentType === "aisdk")}
          >
            AI SDK
          </button>
          <button
            type="button"
            onClick={() => setAgentType("tanstack")}
            className={toolbarButtonClass(agentType === "tanstack")}
          >
            TanStack AI
          </button>
          <InspectorErrorLab />
        </div>
        {chatError ? (
          <div
            role="alert"
            className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
          >
            {chatError}
          </div>
        ) : null}
        <div className="flex-1">
          <CopilotChat
            key={agentType}
            agentId={agentType}
            className={dark ? "dark h-full w-full" : "h-full w-full"}
            attachments={{ enabled: true }}
            onError={(event) => {
              // The prop also accepts React's DOM error handler, so a
              // CopilotKit error is the narrower of the two shapes.
              if (!("error" in event)) return;
              console.error("[CopilotChat] Error:", event);
              const agentId =
                typeof event.context?.agentId === "string"
                  ? event.context.agentId
                  : undefined;
              const toolName =
                typeof event.context?.toolName === "string"
                  ? event.context.toolName
                  : undefined;
              const parts = [
                event.error.message,
                agentId ? `agent ${agentId}` : null,
                toolName ? `tool ${toolName}` : null,
              ].filter(Boolean);
              setChatError(parts.join(" · "));
            }}
          />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
