"use client";

import { useCoAgent, useCopilotAction } from "@copilotkit/react-core";
import { CopilotKitCSSProperties, CopilotSidebar } from "@copilotkit/react-ui";
import { useInterrupt } from "@copilotkit/react-core/v2";
import { useState } from "react";

export default function CopilotKitPage() {
  const [themeColor, setThemeColor] = useState("#6366f1");

  // 🪁 Frontend Actions: https://docs.copilotkit.ai/guides/frontend-actions
  useCopilotAction(
    {
      name: "setThemeColor",
      description: "Set the theme color of the page.",
      parameters: [
        {
          name: "themeColor",
          type: "string",
          description:
            "The theme color to set. Make sure to pick nice colors.",
          required: true,
        },
      ],
      handler({ themeColor }) {
        // Defensive guard: during streaming, the LLM may invoke the handler
        // before the `themeColor` arg has fully arrived. Skipping the update
        // here avoids writing `undefined` into the CSS custom property, which
        // would collapse the --copilot-kit-primary-color variable.
        if (typeof themeColor !== "string" || themeColor.length === 0) return;
        setThemeColor(themeColor);
      },
    },
    [setThemeColor],
  );

  // 🪁 Interrupts: Handle human-in-the-loop confirmations from the agent
  // https://docs.copilotkit.ai/coagents/human-in-the-loop (useInterrupt)
  //
  // The agent emits interrupt payloads shaped as
  //   { action: "delete_proverb"; proverb: string; message: string }
  // Today the only supported action is delete_proverb. When future
  // actions are added, widen InterruptPayload to a discriminated union
  // on `action` and extend APPROVE_LABELS below — TypeScript will flag
  // the missing key as a compile error because APPROVE_LABELS is typed
  // as Record<InterruptPayload["action"], string>.
  useInterrupt({
    render: ({ event, resolve }) => {
      const parsed = parseInterruptPayload(event.value);
      if (!parsed.ok) {
        // Unknown/malformed payload shape. Surface a generic fallback
        // rather than crashing on an unchecked cast. Resolving with a
        // cancellation unblocks the agent in case the user dismisses it.
        // Log the reason + raw payload so developers can diagnose
        // schema drift from the agent side — the UI shows "unknown"
        // without this, which is useless for debugging. The parser
        // itself does not log, so this is the single log line for
        // the whole failure path.
        console.error(
          "[interrupts-langgraph] Unknown interrupt payload shape:",
          parsed.reason,
          event.value,
        );
        return (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-2">
            <p className="text-sm text-red-800">
              Received an unknown interrupt payload. This will tell the agent
              to cancel.
            </p>
            <button
              onClick={() => resolve({ approved: false })}
              className="mt-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel request
            </button>
          </div>
        );
      }

      // Resolve the button label for this action.
      const payload = parsed.value;
      const approveLabel = APPROVE_LABELS[payload.action];

      return (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 my-2">
          <p className="text-sm font-medium text-yellow-800 mb-1">
            Confirmation Required
          </p>
          <p className="text-sm text-yellow-700 mb-3">{payload.message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => resolve({ approved: true })}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
            >
              {approveLabel}
            </button>
            <button
              onClick={() => resolve({ approved: false })}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    },
  });

  return (
    <main
      style={
        { "--copilot-kit-primary-color": themeColor } as CopilotKitCSSProperties
      }
    >
      <YourMainContent themeColor={themeColor} />
      <CopilotSidebar
        clickOutsideToClose={false}
        defaultOpen={true}
        labels={{
          title: "Popup Assistant",
          initial:
            '👋 Hi, there! You\'re chatting with an agent. This agent comes with a few tools to get you started.\n\nFor example you can try:\n- **Frontend Tools**: "Set the theme to orange"\n- **Shared State**: "Write a proverb about AI"\n- **Generative UI**: "Get the weather in SF"\n- **Interrupts**: "Delete the first proverb" (will ask for confirmation)\n\nAs you interact with the agent, you\'ll see the UI update in real-time to reflect the agent\'s **state**, **tool calls**, and **progress**.',
        }}
      />
    </main>
  );
}

// Partial view of the agent state the UI reads + writes. The agent's
// full state is defined in apps/agent/src/agent.ts (AgentStateAnnotation);
// this type intentionally declares only the subset the UI consumes. Keep
// the field names and types in sync with the agent side.
type AgentState = {
  proverbs: string[];
};

// Shape of interrupt payloads produced by deleteProverb on the agent
// side. Validated at runtime by `parseInterruptPayload` below. Kept
// close to the consumer so divergence surfaces in the renderer where
// it's used.
type InterruptPayload = {
  action: "delete_proverb";
  proverb: string;
  message: string;
};

// Approve-button label per interrupt action. Typed exhaustively against
// InterruptPayload["action"] so adding a new action anywhere else in the
// file is a compile error until this map is extended.
const APPROVE_LABELS: Record<InterruptPayload["action"], string> = {
  delete_proverb: "Yes, delete it",
};

// Result type surfaces the first failed predicate as a stable reason
// string so the caller can log a single message containing both the
// reason and the raw value. The parser itself does no logging — the
// renderer owns the single log line (avoids the prior double-log).
type ParseResult =
  | { ok: true; value: InterruptPayload }
  | { ok: false; reason: string };

function parseInterruptPayload(value: unknown): ParseResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "payload is not object" };
  }
  const v = value as Record<string, unknown>;
  if (v.action !== "delete_proverb") {
    return { ok: false, reason: "action mismatch" };
  }
  if (typeof v.proverb !== "string") {
    return { ok: false, reason: "proverb not string" };
  }
  if (typeof v.message !== "string") {
    return { ok: false, reason: "message not string" };
  }
  return {
    ok: true,
    value: {
      action: "delete_proverb",
      proverb: v.proverb,
      message: v.message,
    },
  };
}

function YourMainContent({ themeColor }: { themeColor: string }) {
  // 🪁 Shared State: https://docs.copilotkit.ai/coagents/shared-state
  const { state, setState } = useCoAgent<AgentState>({
    name: "default",
    initialState: {
      proverbs: [
        "CopilotKit may be new, but it's the best thing since sliced bread.",
      ],
    },
  });

  // Defensive default: during transient state-sync, `state` or
  // `state.proverbs` can momentarily be undefined. Coalescing here
  // keeps the map/length checks below from falling into the
  // `undefined !== 0` trap that would hide the "No proverbs yet"
  // empty-state fallback.
  const proverbs = state?.proverbs ?? [];

  // 🪁 Shared State action: writes into the shared agent state above
  //     (not to be confused with a pure frontend action — this mutates
  //     `proverbs`, which is part of the agent's CoAgent state and is
  //     synced back to the graph on the next turn).
  //     https://docs.copilotkit.ai/coagents/shared-state
  useCopilotAction(
    {
      name: "addProverb",
      description: "Add a proverb to the list.",
      parameters: [
        {
          name: "proverb",
          type: "string",
          description: "The proverb to add. Make it witty, short and concise.",
          required: true,
        },
      ],
      handler: ({ proverb }) => {
        // Defensive guard: during streaming, the LLM may invoke the handler
        // before the `proverb` arg has fully arrived. Skipping the update
        // here avoids pushing `undefined` into the proverbs array, which
        // would break React rendering and React key stability.
        if (typeof proverb !== "string" || proverb.length === 0) return;
        setState((prevState) => ({
          ...prevState,
          proverbs: [...(prevState?.proverbs || []), proverb],
        }));
      },
    },
    [setState],
  );

  //🪁 Generative UI: https://docs.copilotkit.ai/coagents/generative-ui
  //
  // `available: "disabled"` is the correct pairing with `render:` here.
  // In @copilotkit/react-core, useCopilotAction routes based on the
  // `available` value (see
  // node_modules/@copilotkit/react-core/src/hooks/use-copilot-action.ts
  // `getActionConfig`):
  //   - "enabled" / "remote"      → frontend tool (handler runs client-side)
  //   - "frontend" / "disabled"   → render-only (registers a tool-call
  //                                 renderer; no handler)
  // We want the BACKEND `getWeather` tool in agent.ts to execute the
  // handler server-side AND have the streamed tool-call args drive a
  // client-side gen-UI render here. The render-only path (via
  // useRenderToolCall) still adds this renderer to
  // `copilotkit.renderToolCalls` regardless of `available`, so the
  // WeatherCard fires during tool-call streaming (see
  // examples/showcases/scene-creator/src/app/page.tsx for the same
  // pattern). Setting `"enabled"` here would register a FRONTEND handler
  // of the same name and collide with the backend tool.
  useCopilotAction(
    {
      name: "getWeather",
      description: "Get the weather for a given location.",
      available: "disabled",
      parameters: [{ name: "location", type: "string", required: true }],
      render: ({ args }) => {
        return (
          <WeatherCard location={args.location} themeColor={themeColor} />
        );
      },
    },
    [themeColor],
  );

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="h-screen w-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
        <h1 className="text-4xl font-bold text-white mb-2 text-center">
          Proverbs
        </h1>
        <p className="text-gray-200 text-center italic mb-6">
          This is a demonstrative page, but it could be anything you want! 🪁
        </p>
        <hr className="border-white/20 my-6" />
        <div className="flex flex-col gap-3">
          {proverbs.map((proverb, index) => (
            // Intentional index-and-content composite key: `${index}-${proverb}`.
            // Plain `proverb` collides on duplicates (React logs a
            // duplicate-key warning and collapses to one node); plain
            // `index` destabilizes rows across agent-side inserts/deletes.
            // The composite tolerates duplicates for this demo where rows
            // are append-only and reordering is not a concern. Migrating
            // to `{id, text}` objects (seeded with crypto.randomUUID())
            // is the proper fix and is deferred to a follow-up since it
            // requires widening AgentState.proverbs.
            <div
              key={`${index}-${proverb}`}
              className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
            >
              <p className="pr-8">{proverb}</p>
              <button
                onClick={() =>
                  setState((prev) => ({
                    ...(prev ?? {}),
                    // Filter by value identity rather than captured index:
                    // between render and click, the agent may have
                    // inserted/removed proverbs, shifting `index` to point
                    // at a different entry. Matching on the string value
                    // is stable (and consistent with the React key above).
                    proverbs: (prev?.proverbs ?? []).filter(
                      (p) => p !== proverb,
                    ),
                  }))
                }
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity
                  bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {proverbs.length === 0 && (
          <p className="text-center text-white/80 italic my-8">
            No proverbs yet. Ask the assistant to add some!
          </p>
        )}
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-14 h-14 text-yellow-200"
    >
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeWidth="2"
        stroke="currentColor"
      />
    </svg>
  );
}

// Weather card rendered by the getWeather action. `location` and
// `themeColor` are driven by the agent's tool-call args + frontend state.
function WeatherCard({
  location,
  themeColor,
}: {
  location?: string;
  themeColor: string;
}) {
  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="rounded-xl shadow-xl mt-6 mb-4 max-w-md w-full"
    >
      <div className="bg-white/20 p-4 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white capitalize">
              {/* During streaming, the tool-call arg may not have arrived
                  yet, leaving `location` undefined and producing a blank
                  heading. Show a loading placeholder in that window. */}
              {location || "Loading…"}
            </h3>
            <p className="text-white">Current Weather</p>
          </div>
          <SunIcon />
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div className="text-3xl font-bold text-white">70°</div>
          <div className="text-sm text-white">Clear skies</div>
        </div>

        <div className="mt-4 pt-4 border-t border-white">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-white text-xs">Humidity</p>
              <p className="text-white font-medium">45%</p>
            </div>
            <div>
              <p className="text-white text-xs">Wind</p>
              <p className="text-white font-medium">5 mph</p>
            </div>
            <div>
              <p className="text-white text-xs">Feels Like</p>
              <p className="text-white font-medium">72°</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
