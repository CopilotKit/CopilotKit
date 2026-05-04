import { CatchAllActionRenderProps } from "@copilotkit/react-core";
import { useState } from "react";

export type BackendToolsProps = CatchAllActionRenderProps & {
  themeColor: string;
};

export function DefaultToolComponent({
  name,
  args,
  status,
  result,
  themeColor,
}: BackendToolsProps) {
  const [showArgs, setShowArgs] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const getStatusColor = () => {
    switch (status) {
      case "executing":
      case "inProgress":
        return "bg-blue-500/20 text-blue-300 border-blue-400/30";
      case "complete":
        return "bg-green-500/20 text-green-300 border-green-400/30";
      default:
        return "bg-white/20 text-white/70 border-white/30";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "executing":
      case "inProgress":
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        );
      case "complete":
        return (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="backdrop-blur-sm rounded-lg p-4 mt-4 mb-4 max-w-md w-full border border-white/20"
    >
      {/* Header with tool name and status */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium text-sm">🔧 {name}</h3>
        <span
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor()}`}
        >
          {getStatusIcon()}
          {status}
        </span>
      </div>

      {/* Arguments */}
      {args && Object.keys(args).length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-2 text-white/80 text-xs font-medium mb-1.5 hover:text-white transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showArgs ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Arguments
          </button>
          {showArgs && (
            <div className="bg-black/20 rounded p-2 space-y-1">
              {Object.entries(args).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-white/50 text-xs">{key}:</span>
                  <span className="text-white/80 text-xs font-mono">
                    {JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div>
          <button
            onClick={() => setShowResult(!showResult)}
            className="flex items-center gap-2 text-white/80 text-xs font-medium mb-1.5 hover:text-white transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showResult ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            Result
          </button>
          {showResult && (
            <div className="bg-black/20 rounded p-2">
              <pre className="text-white/80 text-xs font-mono whitespace-pre-wrap break-words">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
