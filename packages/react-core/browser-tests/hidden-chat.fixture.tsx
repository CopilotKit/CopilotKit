import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CopilotChatConfigurationProvider,
  CopilotChatView,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

const params = new URLSearchParams(window.location.search);
const count = Number(params.get("count") ?? "80");
const nextCount = Number(params.get("nextCount") ?? String(count));
const mode = params.get("mode") === "none" ? "none" : "pin-to-bottom";
const standalone = params.get("standalone") === "true";

function App() {
  const [hidden, setHidden] = useState(false);
  const [thread, setThread] = useState("one");
  const [tick, setTick] = useState(0);
  const [prepended, setPrepended] = useState(false);
  const [trimmed, setTrimmed] = useState(false);
  // A fresh array makes CopilotChatMessageView re-render through its memoized
  // slot wrapper while hidden and after the host becomes measurable again.
  const messages = [
    ...(prepended
      ? [
          {
            id: "older",
            role: "user" as const,
            content: "Older message " + "sample text ".repeat(20),
          },
        ]
      : []),
    ...Array.from({ length: thread === "one" ? count : nextCount }, (_, i) => ({
      id: `${thread}-${i}`,
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      content: `Message ${i} ${"sample text ".repeat(20)}`,
    })).slice(trimmed ? 1 : 0),
  ];
  const chat = (
    <CopilotChatView
      welcomeScreen={false}
      autoScroll={mode}
      messages={messages}
      input={() => <div style={{ height: 40 }} />}
    />
  );

  return (
    <main>
      <button id="hide" onClick={() => setHidden(true)}>
        Hide
      </button>
      <button id="show" onClick={() => setHidden(false)}>
        Show
      </button>
      <button id="rerender" onClick={() => setTick((n) => n + 1)}>
        Rerender
      </button>
      <button
        id="switch-thread"
        onClick={() => setThread((t) => (t === "one" ? "two" : "one"))}
      >
        Switch thread
      </button>
      <button id="prepend" onClick={() => setPrepended(true)}>
        Load older
      </button>
      <button id="trim-oldest" onClick={() => setTrimmed(true)}>
        Trim oldest
      </button>
      <span id="tick">{tick}</span>
      <div
        id="host"
        style={{ display: hidden ? "none" : "block", height: 500, width: 700 }}
      >
        <CopilotKitProvider>
          {standalone ? (
            chat
          ) : (
            <CopilotChatConfigurationProvider threadId={thread}>
              {chat}
            </CopilotChatConfigurationProvider>
          )}
        </CopilotKitProvider>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
