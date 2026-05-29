"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useConfigureSuggestions,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { z } from "zod";

export const dynamic = "force-dynamic";

const runCodeSchema = z.object({
  code: z.string(),
  language: z.enum(["python", "typescript", "javascript"]).default("python"),
});

const card: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  background: "#ffffff",
  padding: "10px 12px",
  margin: "8px 0",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  color: "#0f172a",
};
const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};
const langPill: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 999,
  background: "#eef2ff",
  color: "#4338ca",
  border: "1px solid #c7d2fe",
};
const statusText: React.CSSProperties = {
  fontSize: 12,
  color: "#475569",
  marginLeft: "auto",
};
const sandboxTag: React.CSSProperties = {
  fontWeight: 600,
  letterSpacing: 0.2,
};

// Tall fixed-height (~12 lines) scrollable code pane — the visual emphasis of the demo.
const codeScroller: React.CSSProperties = {
  height: "18em",
  overflow: "auto",
  borderRadius: 6,
  background: "#1e1e1e", // matches vscDarkPlus
  border: "1px solid #1e1e1e",
};
const codeHighlighterStyle: React.CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  background: "transparent",
  fontSize: 12,
  lineHeight: 1.5,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  fontWeight: 400,
  marginBottom: 4,
  letterSpacing: 0.3,
};
const codeLabel: React.CSSProperties = { ...labelStyle, marginTop: 0 };
const resultLabel: React.CSSProperties = { ...labelStyle, marginTop: 10 };
const resultPane: React.CSSProperties = {
  height: "4.6em",
  overflow: "auto",
  margin: 0,
  padding: "6px 10px",
  background: "#0f172a",
  color: "#e2e8f0",
  borderRadius: 6,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

function Spinner() {
  return (
    <span
      aria-label="working"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        border: "2px solid #cbd5e1",
        borderTopColor: "#6366f1",
        borderRadius: "50%",
        animation: "cpkSpin 0.8s linear infinite",
      }}
    />
  );
}

function RunCodeCard({
  status,
  parameters,
  result,
}: {
  status: "inProgress" | "executing" | "complete";
  parameters: Partial<{
    code: string;
    language: "python" | "typescript" | "javascript";
  }>;
  result: string | undefined;
}) {
  const language = parameters?.language ?? "python";
  const code = parameters?.code ?? "";

  const codeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 24) el.scrollTop = el.scrollHeight;
  }, [code]);

  const head = (label: React.ReactNode) => (
    <div style={header}>
      <span style={sandboxTag}>Daytona sandbox</span>
      <span style={langPill}>{language}</span>
      <span style={statusText}>{label}</span>
    </div>
  );

  const codeBlock = code ? (
    <>
      <div style={codeLabel}>Generated code:</div>
      <div ref={codeRef} style={codeScroller}>
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={codeHighlighterStyle}
          wrapLongLines={false}
          PreTag="div"
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </>
  ) : null;

  if (status === "inProgress") {
    return (
      <div style={card}>
        {head(
          <>
            <Spinner /> &nbsp;preparing…
          </>,
        )}
        {codeBlock}
      </div>
    );
  }

  if (status === "executing") {
    return (
      <div style={card}>
        {head(
          <>
            <Spinner /> &nbsp;running…
          </>,
        )}
        {codeBlock}
      </div>
    );
  }

  let stdout = "";
  let exitCode = 0;
  try {
    const parsed = JSON.parse(result ?? "{}");
    stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
    exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : 0;
  } catch {
    stdout = String(result ?? "");
  }
  const ok = exitCode === 0;

  return (
    <div style={card}>
      {head(
        <span style={{ color: ok ? "#15803d" : "#b91c1c" }}>
          {ok ? "✓ done" : `✗ exit ${exitCode}`}
        </span>,
      )}
      {codeBlock}
      <div style={resultLabel}>Result:</div>
      <pre style={resultPane}>{stdout || "(no output)"}</pre>
    </div>
  );
}

function RegisterRenderers() {
  useRenderTool(
    {
      name: "runCode",
      parameters: runCodeSchema,
      render: (props) => (
        <RunCodeCard
          status={props.status as "inProgress" | "executing" | "complete"}
          parameters={
            props.parameters as Partial<{
              code: string;
              language: "python" | "typescript" | "javascript";
            }>
          }
          result={(props as { result?: string }).result}
        />
      ),
    },
    [],
  );

  // Starter pills under the input — descriptive titles, kept available across
  // the conversation so users can try each language without scrolling back.
  useConfigureSuggestions(
    {
      available: "always",
      suggestions: [
        {
          title: "Python — Zoo animals",
          message: "Run a Python snippet listing 20 popular zoo animals",
        },
        {
          title: "TypeScript — Fibonacci numbers",
          message:
            "Run TypeScript that builds an array of the first 10 Fibonacci numbers and logs the JSON",
        },
        {
          title: "JavaScript — Current timestamp",
          message: "Run JavaScript that logs the current timestamp",
        },
      ],
    },
    [],
  );

  return null;
}

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-single" useSingleEndpoint>
      <RegisterRenderers />
      <style>{`@keyframes cpkSpin { to { transform: rotate(360deg); } }`}</style>
      <main
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: 0,
          margin: 0,
        }}
      >
        <CopilotChatConfigurationProvider
          labels={{
            welcomeMessageText:
              "Ready to run code in a Daytona sandbox. Try a starter below, or describe what you'd like to execute.",
          }}
        >
          <section
            style={{
              flex: 1,
              minHeight: 0,
              width: "100%",
              background: "#ffffff",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CopilotChat />
          </section>
        </CopilotChatConfigurationProvider>
      </main>
    </CopilotKitProvider>
  );
}
