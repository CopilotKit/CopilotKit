import { z } from "zod";
import {
  createCatalog,
  type CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import React from "react";

const definitions = {
  ChatBubble: {
    description: "A chat message bubble",
    props: z.object({
      message: z.string(),
      sender: z.string(),
      time: z.string(),
      isUser: z.boolean().optional(),
      isThinking: z.boolean().optional(),
    }),
  },

  CodeBlock: {
    description: "A syntax-highlighted code snippet in a chat",
    props: z.object({
      code: z.string(),
      language: z.string().optional(),
      filename: z.string().optional(),
    }),
  },

  SuggestionChips: {
    description: "Quick-reply suggestion buttons",
    props: z.object({
      suggestions: z.array(z.string()),
    }),
  },

  ToolCallCard: {
    description: "Shows an agent tool call with args and result",
    props: z.object({
      tool: z.string(),
      args: z.string(),
      result: z.string().optional(),
      status: z.enum(["running", "success", "error"]).optional(),
    }),
  },

  SourceCard: {
    description: "A citation/source reference card",
    props: z.object({
      sources: z.array(
        z.object({
          title: z.string(),
          url: z.string().optional(),
          snippet: z.string().optional(),
        }),
      ),
    }),
  },
};

const renderers: CatalogRenderers<typeof definitions> = {
  // Tailwind
  ChatBubble: ({ props }) => {
    const isUser = props.isUser ?? false;
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[80%] rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-blue-600 text-white rounded-br-sm"
              : "bg-neutral-800 text-neutral-200 rounded-bl-sm"
          }`}
        >
          <div
            className={`text-xs mb-1 font-medium ${isUser ? "text-blue-200" : "text-neutral-400"}`}
          >
            {props.sender}
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {props.isThinking ? (
              <span className="inline-flex gap-1">
                <span className="w-2 h-2 bg-neutral-500 rounded-full animate-pulse" />
                <span
                  className="w-2 h-2 bg-neutral-500 rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                />
                <span
                  className="w-2 h-2 bg-neutral-500 rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                />
              </span>
            ) : (
              props.message
            )}
          </div>
          <div
            className={`text-[10px] mt-1 ${isUser ? "text-blue-300" : "text-neutral-500"}`}
          >
            {props.time}
          </div>
        </div>
      </div>
    );
  },

  // Inline styles
  CodeBlock: ({ props }) => (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #30363d",
        borderRadius: "8px",
        overflow: "hidden",
        fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
        fontSize: "12px",
      }}
    >
      {props.filename && (
        <div
          style={{
            background: "#161b22",
            borderBottom: "1px solid #30363d",
            padding: "6px 12px",
            fontSize: "11px",
            color: "#8b949e",
          }}
        >
          {props.filename}{" "}
          {props.language && (
            <span style={{ color: "#484f58" }}>({props.language})</span>
          )}
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: "12px",
          color: "#c9d1d9",
          overflowX: "auto",
          lineHeight: 1.6,
        }}
      >
        <code>{props.code}</code>
      </pre>
    </div>
  ),

  // Tailwind
  SuggestionChips: ({ props }) => (
    <div className="flex flex-wrap gap-2">
      {props.suggestions.map((s, i) => (
        <button
          key={i}
          className="px-4 py-2 bg-transparent border border-blue-700/50 rounded-full text-xs text-blue-400 hover:bg-blue-900/30 hover:border-blue-600 transition-colors cursor-pointer"
        >
          {s}
        </button>
      ))}
    </div>
  ),

  // Tailwind
  ToolCallCard: ({ props }) => {
    const statusConfig: Record<
      string,
      { icon: string; color: string; bg: string }
    > = {
      running: {
        icon: "\u23F3",
        color: "text-yellow-400",
        bg: "bg-yellow-900/20 border-yellow-800/30",
      },
      success: {
        icon: "\u2705",
        color: "text-green-400",
        bg: "bg-green-900/20 border-green-800/30",
      },
      error: {
        icon: "\u274C",
        color: "text-red-400",
        bg: "bg-red-900/20 border-red-800/30",
      },
    };
    const s = statusConfig[props.status ?? "success"];
    return (
      <div className={`border rounded-lg p-3 text-xs font-mono ${s.bg}`}>
        <div className="flex items-center gap-2 mb-2">
          <span>{s.icon}</span>
          <span className={`font-semibold ${s.color}`}>{props.tool}</span>
        </div>
        <div className="text-neutral-500 mb-1">Args:</div>
        <pre className="text-neutral-300 bg-black/30 rounded p-2 m-0 overflow-x-auto whitespace-pre-wrap">
          {props.args}
        </pre>
        {props.result && (
          <>
            <div className="text-neutral-500 mt-2 mb-1">Result:</div>
            <pre className="text-neutral-300 bg-black/30 rounded p-2 m-0 overflow-x-auto whitespace-pre-wrap">
              {props.result}
            </pre>
          </>
        )}
      </div>
    );
  },

  // Inline styles
  SourceCard: ({ props }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {props.sources.map((src, i) => (
        <div
          key={i}
          style={{
            background: "#1c1c2e",
            border: "1px solid #2e2e4a",
            borderRadius: "8px",
            padding: "12px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#a5b4fc" }}>
            {src.title}
          </div>
          {src.url && (
            <div
              style={{ fontSize: "11px", color: "#6366f1", marginTop: "2px" }}
            >
              {src.url}
            </div>
          )}
          {src.snippet && (
            <p
              style={{
                fontSize: "12px",
                color: "#94a3b8",
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              {src.snippet}
            </p>
          )}
        </div>
      ))}
    </div>
  ),
};

export const catalog = createCatalog(definitions, renderers, {
  catalogId: "copilotkit://chat-interface",
  includeBasicCatalog: true,
});

export default catalog;
