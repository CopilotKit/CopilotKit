"use client";

import React from "react";

export interface HaikuCardProps {
  loading: boolean;
  topic: string;
  lines?: string[];
}

export function HaikuCard({ loading, topic, lines }: HaikuCardProps) {
  return (
    <div className="mt-2 mb-2 max-w-sm rounded-xl border border-[#DBDBE5] bg-white p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
        {loading ? "Composing haiku" : "Haiku"}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#010507]">
        {topic ? `On: ${topic}` : "On: ..."}
      </div>
      <div className="mt-2 space-y-0.5 font-serif text-sm italic text-[#010507]">
        {loading || !lines
          ? [1, 2, 3].map((i) => (
              <div key={i} className="text-[#AFAFB7]">
                ...
              </div>
            ))
          : lines.map((line, i) => <div key={i}>{line}</div>)}
      </div>
    </div>
  );
}
