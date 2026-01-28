import React, { useCallback, useId as reactUseId } from "react";
import { GraphQLError } from "@copilotkit/runtime-client-gql";
import { useToast } from "../toast/toast-provider";
import { ExclamationMarkIcon } from "../toast/exclamation-mark-icon";

/**
 * BACKWARD COMPATIBILITY: Supporting both React 17 and React 18+
 *
 * Problem: streamdown uses React's useId hook, which was introduced in React 18.
 * This causes "useId is not a function" errors for users on React 17.
 *
 * Solution: Import both renderers and auto-detect React version at runtime.
 * - React 18+: Uses streamdown (modern, optimized for AI streaming)
 * - React 17: Falls back to react-markdown (proven, stable)
 *
 * Modern bundlers will tree-shake the unused renderer, so bundle size
 * impact is minimal for users on either version.
 */
import { Streamdown } from "streamdown";
import ReactMarkdown from "react-markdown";

// Auto-detect React version by checking for React 18+ useId hook
const hasUseId = typeof reactUseId === "function";

interface OriginalError {
  message?: string;
  stack?: string;
}

export function ErrorToast({ errors }: { errors: (Error | GraphQLError)[] }) {
  const errorsToRender = errors.map((error, idx) => {
    const originalError =
      "extensions" in error ? (error.extensions?.originalError as undefined | OriginalError) : {};
    const message = originalError?.message ?? error.message;
    const code = "extensions" in error ? (error.extensions?.code as string) : null;

    return (
      <div
        key={idx}
        style={{
          marginTop: idx === 0 ? 0 : 10,
          marginBottom: 14,
        }}
      >
        <ExclamationMarkIcon style={{ marginBottom: 4 }} />

        {code && (
          <div
            style={{
              fontWeight: "600",
              marginBottom: 4,
            }}
          >
            Copilot Runtime Error:{" "}
            <span style={{ fontFamily: "monospace", fontWeight: "normal" }}>{code}</span>
          </div>
        )}
        {/* Use streamdown (React 18+) or react-markdown (React 17) based on available hooks */}
        {hasUseId ? <Streamdown>{message}</Streamdown> : <ReactMarkdown>{message}</ReactMarkdown>}
      </div>
    );
  });
  return (
    <div
      style={{
        fontSize: "13px",
        maxWidth: "600px",
      }}
    >
      {errorsToRender}
      <div style={{ fontSize: "11px", opacity: 0.75 }}>
        NOTE: This error only displays during local development.
      </div>
    </div>
  );
}

export function useErrorToast() {
  const { addToast } = useToast();

  return useCallback(
    (errors: (Error | GraphQLError)[]) => {
      const errorId = errors
        .map((err) => {
          const message =
            "extensions" in err
              ? (err.extensions?.originalError as any)?.message || err.message
              : err.message;
          const stack = err.stack || "";
          return btoa(message + stack).slice(0, 32); // Create hash from message + stack
        })
        .join("|");

      addToast({
        type: "error",
        id: errorId, // Toast libraries typically dedupe by id
        message: <ErrorToast errors={errors} />,
      });
    },
    [addToast],
  );
}

export function useAsyncCallback<T extends (...args: any[]) => Promise<any>>(
  callback: T,
  deps: Parameters<typeof useCallback>[1],
) {
  const addErrorToast = useErrorToast();
  return useCallback(async (...args: Parameters<T>) => {
    try {
      return await callback(...args);
    } catch (error) {
      console.error("Error in async callback:", error);
      // @ts-ignore
      addErrorToast([error]);
      throw error;
    }
  }, deps);
}
