"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  ToolCallStatus,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useCopilotChatConfiguration,
  useCopilotKit,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { randomUUID } from "@copilotkit/shared";
import { Suspense, useEffect, useState } from "react";
import { z } from "zod";
import { findDeal } from "@/lib/deals";
import type { Deal } from "@/lib/deals";

const approveDealArgs = z.object({ dealId: z.string(), amount: z.number() });

export default function DealPage() {
  return (
    <Suspense>
      <DealThread />
    </Suspense>
  );
}

// Threads opened in this tab that have no messages yet. Kept across a
// reload, so the chat does not try to connect to a Thread the backend has
// not created.
const NEW_THREADS_KEY = "copilotkit-learning-demo:new-threads";

function readNewThreads(): Set<string> {
  try {
    const raw = sessionStorage.getItem(NEW_THREADS_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeNewThreads(ids: Set<string>) {
  try {
    sessionStorage.setItem(NEW_THREADS_KEY, JSON.stringify([...ids]));
  } catch {
    // Without storage a reload treats the Thread as saved, as before.
  }
}

/**
 * Keeps the open Thread in the URL, so a reload reconnects to the same chat
 * and shows the feedback given there again. A Thread opened here is new
 * until it has messages: it starts on the welcome screen instead of
 * connecting to a saved chat, also after a reload.
 */
function DealThread() {
  const { id } = useParams<{ id: string }>();
  const deal = findDeal(id);
  // An empty `?thread=` names no Thread.
  const threadId = useSearchParams().get("thread") || null;
  const pathname = usePathname();
  const router = useRouter();
  // Read once per mount: a Thread stays new while its chat is open, so the
  // chat never reconnects in the middle of its first run.
  const [openedHere] = useState(() =>
    typeof window === "undefined" ? new Set<string>() : readNewThreads(),
  );
  const openNewThread = () => {
    const next = randomUUID();
    openedHere.add(next);
    writeNewThreads(new Set([...readNewThreads(), next]));
    router.replace(`${pathname}?thread=${next}`);
  };
  const markThreadUsed = (used: string) => {
    const ids = readNewThreads();
    if (ids.delete(used)) writeNewThreads(ids);
  };

  useEffect(() => {
    if (threadId === null) openNewThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open one Thread per missing id
  }, [threadId]);

  if (deal === undefined) return <p>Unknown deal.</p>;
  if (threadId === null) return null;

  return (
    <CopilotChatConfigurationProvider
      agentId="default"
      threadId={threadId}
      hasExplicitThreadId={!openedHere.has(threadId)}
    >
      <DealView
        deal={deal}
        onNewThread={openNewThread}
        onThreadUsed={markThreadUsed}
      />
    </CopilotChatConfigurationProvider>
  );
}

function DealView({
  deal,
  onNewThread,
  onThreadUsed,
}: {
  deal: Deal;
  onNewThread: () => void;
  onThreadUsed: (threadId: string) => void;
}) {
  const config = useCopilotChatConfiguration();
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  const hasMessages = agent.messages.length > 0;
  useEffect(() => {
    if (hasMessages && config?.threadId) onThreadUsed(config.threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- record once per Thread
  }, [hasMessages, config?.threadId]);
  const { copilotkit } = useCopilotKit();
  const [approvedHere, setApprovedHere] = useState(false);
  // A decision belongs to its Thread. The chat stays mounted, so it sees the
  // Thread change and clears the previous Thread's messages itself.
  const threadId = config?.threadId;
  const [decisionThread, setDecisionThread] = useState(threadId);
  if (decisionThread !== threadId) {
    setDecisionThread(threadId);
    setApprovedHere(false);
  }

  // Clicks show what the person did; these events record the outcome itself.
  const recordDecision = (
    decision: "approved" | "rejected",
    via: "agent" | "page",
  ) =>
    copilotkit.emitTrajectoryEvent(`deal.${decision}`, {
      dealId: deal.id,
      via,
    });

  useAgentContext({
    description: "The deal the user is looking at",
    value: { dealId: deal.id, amount: deal.amount },
  });

  useHumanInTheLoop({
    name: "approveDeal",
    description: "Ask the user to approve or reject the deal",
    parameters: approveDealArgs,
    render: ({ args, status, respond, result }) => {
      if (status === ToolCallStatus.Complete) {
        return (
          <p className="text-sm text-gray-600">
            Decision recorded: {String(result)}
          </p>
        );
      }
      return (
        <div className="my-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm">
            Approve {args.dealId} for ${args.amount?.toLocaleString("en-US")}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-copilotkit-action="hitl.approve"
              disabled={respond === undefined}
              onClick={() => {
                void respond?.("approved");
                recordDecision("approved", "agent");
              }}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              data-copilotkit-action="hitl.reject"
              disabled={respond === undefined}
              onClick={() => {
                void respond?.("rejected");
                recordDecision("rejected", "agent");
              }}
              className="rounded bg-gray-200 px-3 py-1 text-sm disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      );
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section>
        <h1 className="mb-1 text-2xl font-semibold">{deal.name}</h1>
        <p className="mb-4 text-gray-500">
          ${deal.amount.toLocaleString("en-US")} · {deal.stage}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-copilotkit-action="deal.approve"
            onClick={() => {
              setApprovedHere(true);
              recordDecision("approved", "page");
            }}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
          >
            {approvedHere ? "Approved" : "Approve without the agent"}
          </button>
          <button
            type="button"
            data-copilotkit-action="thread.new"
            onClick={onNewThread}
            className="rounded border px-3 py-1.5 text-sm"
          >
            New thread
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Open thread: <code>{config?.threadId}</code>
        </p>
      </section>
      <section className="h-[600px] rounded border">
        <CopilotChat />
      </section>
    </div>
  );
}
