"use client";

import React, { useEffect, useState } from "react";

export type A2UIInferenceFormat = "express" | "direct_json";

/** A format change starts a fresh provider and conversation. */
export function A2UIFormat({
  children,
  template = false,
}: {
  children: (format: A2UIInferenceFormat) => React.ReactNode;
  template?: boolean;
}) {
  const [format, setFormat] = useState<A2UIInferenceFormat>("express");
  useEffect(() => {
    const read = () => {
      const value = new URL(window.location.href).searchParams.get("format");
      setFormat(value === "direct_json" ? "direct_json" : "express");
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  return (
    <div className="flex h-screen w-full flex-col">
      <div className="flex items-center justify-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 text-sm">
        <label htmlFor="a2ui-format">
          {template ? "Template format" : "Inference format"}
        </label>
        <select
          id="a2ui-format"
          data-testid="a2ui-format"
          value={format}
          onChange={(event) => {
            const next = event.target.value as A2UIInferenceFormat;
            const url = new URL(window.location.href);
            url.searchParams.set("format", next);
            window.history.replaceState(null, "", url);
            setFormat(next);
          }}
          className="rounded border border-neutral-300 bg-white px-2 py-1"
        >
          <option value="express">A2UI Express</option>
          <option value="direct_json">Direct JSON</option>
        </select>
        {template && (
          <span className="text-neutral-500">
            Authored layout; the agent supplies flight data.
          </span>
        )}
      </div>
      <div
        className="min-h-0 flex-1"
        data-testid="a2ui-conversation"
        key={format}
      >
        {children(format)}
      </div>
    </div>
  );
}
