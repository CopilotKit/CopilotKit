"use client";

import {
  CopilotKitProvider,
  CopilotSidebar,
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

// Fixed-height (~6 lines) scrollable container that wraps the syntax-highlighted code.
const codeScroller: React.CSSProperties = {
  height: "9em", // ~6 lines @ 12px / 1.5 line-height
  overflow: "auto",
  borderRadius: 6,
  background: "#1e1e1e", // matches vscDarkPlus
  border: "1px solid #1e1e1e",
};
// SyntaxHighlighter is told to fill the scroller — its internal <pre> shouldn't add margins.
const codeHighlighterStyle: React.CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  background: "transparent",
  fontSize: 12,
  lineHeight: 1.5,
};
const codeLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  fontWeight: 400,
  marginTop: 0,
  marginBottom: 4,
  letterSpacing: 0.3,
};
const resultLabel: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  fontWeight: 400,
  marginTop: 8,
  marginBottom: 4,
  letterSpacing: 0.3,
};
// Fixed-height (~3 lines) scrollable result pane.
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

// Subcomponent so we can use hooks (auto-scroll while code streams).
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

  // Auto-scroll the code pane to follow streaming, but only if the user is
  // already at (near) the bottom — otherwise we'd yank them down while they
  // were reading earlier lines.
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

  // complete — result is a JSON-serialized { stdout, exitCode } string.
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
  return null;
}

export default function Page() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-single" useSingleEndpoint>
      <RegisterRenderers />
      <style>{`@keyframes cpkSpin { to { transform: rotate(360deg); } }`}</style>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "2rem",
          textAlign: "center",
          gap: "0.75rem",
          background: "linear-gradient(160deg,#f8fafc,#eef2ff)",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", margin: 0 }}>CopilotKit × Daytona</h1>
        <p style={{ maxWidth: 560, color: "#475569", lineHeight: 1.6 }}>
          This is the CopilotKit built-in agent with one extra server tool:{" "}
          <code>runCode</code>, which executes Python, TypeScript, or JavaScript
          in an isolated Daytona sandbox. Open the chat and ask it to run
          something — e.g.{" "}
          <em>
            “run a Python snippet that prints the first 10 Fibonacci numbers”
          </em>{" "}
          or <em>“run JavaScript that logs Date.now().”</em>
        </p>
      </main>
      <CopilotSidebar defaultOpen />
    </CopilotKitProvider>
  );
}
