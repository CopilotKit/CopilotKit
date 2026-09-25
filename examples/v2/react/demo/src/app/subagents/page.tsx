"use client";

// Subagent groups in CopilotChat, at /subagents. A scripted agent in the
// browser streams AG-UI 1.0 subagent events: a supervisor delegates to two
// parallel subagents, and one of them starts a nested subagent. It needs no
// LLM or runtime. The panel on the right reads the same list with useSubagents.

import {
  CopilotChat,
  CopilotKitProvider,
  useDefaultRenderTool,
  useSubagents,
} from "@copilotkit/react-core/v2";
import type { CopilotChatSubagentProps } from "@copilotkit/react-core/v2";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { useState } from "react";

export const dynamic = "force-dynamic";

type Step = { delay: number; event: Record<string, unknown> };

function text(
  messageId: string,
  words: string,
  subagentRunId?: string,
): Step[] {
  const parts = words.split(" ");
  return [
    {
      delay: 60,
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
        subagentRunId,
      },
    },
    ...parts.map((word, index) => ({
      delay: 70,
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: index === 0 ? word : ` ${word}`,
      },
    })),
    { delay: 20, event: { type: EventType.TEXT_MESSAGE_END, messageId } },
  ];
}

function toolCall(
  toolCallId: string,
  toolCallName: string,
  parentMessageId: string,
  args: object,
  subagentRunId?: string,
): Step[] {
  return [
    {
      delay: 150,
      event: {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName,
        parentMessageId,
        subagentRunId,
      },
    },
    {
      delay: 80,
      event: {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(args),
      },
    },
    { delay: 40, event: { type: EventType.TOOL_CALL_END, toolCallId } },
  ];
}

function result(
  toolCallId: string,
  content: string,
  subagentRunId?: string,
): Step {
  return {
    delay: 200,
    event: {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: `${toolCallId}-result`,
      role: "tool",
      content,
      subagentRunId,
    },
  };
}

/** Interleave two step lists so two subagents stream at the same time. */
function interleave(a: Step[], b: Step[]): Step[] {
  const merged: Step[] = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index]) merged.push(a[index]!);
    if (b[index]) merged.push(b[index]!);
  }
  return merged;
}

function script(input: RunAgentInput, runNumber: number): Step[] {
  const id = (name: string) => `${name}-${runNumber}`;
  const research = id("research");
  const writer = id("writer");
  const checker = id("fact-checker");
  return [
    {
      delay: 0,
      event: {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      },
    },
    ...text(
      id("supervisor"),
      "I will split this between a researcher and a writer.",
    ),
    ...toolCall(id("call-research"), "delegate_research", id("supervisor"), {
      task: "Find sources",
    }),
    ...toolCall(id("call-write"), "delegate_writing", id("supervisor"), {
      task: "Draft the intro",
    }),
    {
      delay: 150,
      event: {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: research,
        name: "researcher",
        description: "Finds sources",
        parentToolCallId: id("call-research"),
        parentMessageId: id("supervisor"),
      },
    },
    {
      delay: 150,
      event: {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: writer,
        name: "writer",
        description: "Drafts text",
        parentToolCallId: id("call-write"),
        parentMessageId: id("supervisor"),
      },
    },
    // The two subagents stream in parallel.
    ...interleave(
      text(
        id("r1"),
        "Searching recent papers and blog posts on the topic.",
        research,
      ),
      text(
        id("w1"),
        "Drafting an intro paragraph while the research runs.",
        writer,
      ),
    ),
    ...toolCall(
      id("call-search"),
      "web_search",
      id("r1"),
      { query: "agent UI protocols" },
      research,
    ),
    // The researcher starts a nested fact-checker under its own tool call.
    ...toolCall(
      id("call-check"),
      "delegate_fact_check",
      id("r1"),
      { claims: 3 },
      research,
    ),
    {
      delay: 150,
      event: {
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: checker,
        name: "fact-checker",
        parentSubagentRunId: research,
        parentToolCallId: id("call-check"),
      },
    },
    ...text(
      id("c1"),
      "Checked 3 claims. All of them match their sources.",
      checker,
    ),
    {
      delay: 200,
      event: { type: EventType.SUBAGENT_FINISHED, subagentRunId: checker },
    },
    result(id("call-check"), "3 of 3 claims verified", research),
    result(id("call-search"), "Found 3 sources", research),
    ...interleave(
      text(id("r2"), "Done. I found 3 good sources.", research),
      text(id("w2"), "The intro is ready for review.", writer),
    ),
    {
      delay: 300,
      event: {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: research,
        result: { sources: 3 },
      },
    },
    {
      delay: 500,
      event: { type: EventType.SUBAGENT_FINISHED, subagentRunId: writer },
    },
    result(id("call-research"), "3 sources"),
    result(id("call-write"), "Intro drafted"),
    ...text(
      id("final"),
      "Here is the summary: 3 checked sources and a drafted intro.",
    ),
    {
      delay: 50,
      event: {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      },
    },
  ];
}

class ScriptedSupervisor extends AbstractAgent {
  private runs = 0;

  clone(): ScriptedSupervisor {
    const cloned = new ScriptedSupervisor({ agentId: this.agentId });
    cloned.runs = this.runs;
    return cloned;
  }

  run(input: RunAgentInput) {
    this.runs += 1;
    const steps = script(input, this.runs);
    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = (index: number) => {
        if (cancelled) return;
        if (index >= steps.length) return subscriber.complete();
        timer = setTimeout(() => {
          subscriber.next(steps[index]!.event as BaseEvent);
          next(index + 1);
        }, steps[index]!.delay);
      };
      next(0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    });
  }
}

const agents = { default: new ScriptedSupervisor({ agentId: "default" }) };

function CustomGroup({ subagent, children }: CopilotChatSubagentProps) {
  return (
    <section
      style={{
        margin: "8px 0",
        padding: 12,
        borderRadius: 12,
        border: "2px dashed #8b5cf6",
        background: "#f5f3ff",
      }}
    >
      <strong style={{ color: "#6d28d9" }}>
        Custom slot: {subagent?.name ?? "Subagent"} (
        {subagent?.status ?? "unknown"})
      </strong>
      {children}
    </section>
  );
}

function ProgressPanel() {
  const subagents = useSubagents();
  return (
    <aside
      style={{
        width: 280,
        padding: 16,
        borderLeft: "1px solid #e5e5e5",
        fontSize: 14,
      }}
    >
      <h2 style={{ fontWeight: 600, marginBottom: 8 }}>useSubagents()</h2>
      {subagents.length === 0 ? (
        <p style={{ color: "#737373" }}>No subagents yet. Send any message.</p>
      ) : (
        <ul style={{ display: "grid", gap: 6 }}>
          {subagents.map((subagent) => (
            <li key={subagent.subagentRunId}>
              <code>{subagent.name}</code>: {subagent.status}
              {subagent.parentSubagentRunId
                ? ` (inside ${subagents.find((parent) => parent.subagentRunId === subagent.parentSubagentRunId)?.name ?? "parent"})`
                : ""}
              {subagent.error
                ? ` (${subagent.error.code ?? subagent.error.message})`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Demo() {
  useDefaultRenderTool();
  const [custom, setCustom] = useState(false);
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid #e5e5e5",
            display: "flex",
            gap: 16,
            alignItems: "center",
          }}
        >
          <strong>Subagent groups</strong>
          <label style={{ fontSize: 14 }}>
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => setCustom(e.target.checked)}
            />{" "}
            Use a custom <code>subagent</code> slot
          </label>
          <span style={{ fontSize: 13, color: "#737373" }}>
            Tip: press stop during a run to see cancelled groups.
          </span>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <CopilotChat
            messageView={custom ? { subagent: CustomGroup } : undefined}
          />
        </div>
      </main>
      <ProgressPanel />
    </div>
  );
}

export default function SubagentsDemoPage() {
  return (
    <CopilotKitProvider agents__unsafe_dev_only={agents}>
      <Demo />
    </CopilotKitProvider>
  );
}
