"use client";

import type { DiscourseReport } from "@/lib/discourse";

export default function SentimentSplit({
  report,
}: {
  report: DiscourseReport;
}) {
  const { bull, bear } = report.sentiment;

  return (
    <div style={{ padding: "14px 18px 16px" }}>
      <div className="section-title">
        <span className="label">Sentiment</span>
        <div className="rule" />
        {/* Scan meta lives on the summary panel above; repeating it here reads
            as two different measurements of the same thing. */}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 38,
              lineHeight: "38px",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: bull > 0 ? "var(--bull)" : "var(--text-3)",
            }}
          >
            {bull}%
          </span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>positive</span>
        </div>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>critical</span>
          <span
            style={{
              fontSize: 38,
              lineHeight: "38px",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: bear > 0 ? "var(--bear)" : "var(--text-3)",
            }}
          >
            {bear}%
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 2,
          height: 6,
          borderRadius: 9999,
          overflow: "hidden",
        }}
      >
        {bull > 0 && (
          <div
            style={{
              width: `${bull}%`,
              background: "var(--bull)",
              borderRadius: 9999,
              transformOrigin: "left",
              animation: "bar-grow 560ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        )}
        {bear > 0 && (
          <div
            style={{
              width: `${bear}%`,
              background: "var(--bear)",
              borderRadius: 9999,
              transformOrigin: "left",
              animation:
                "bar-grow 560ms cubic-bezier(0.22, 1, 0.36, 1) 90ms both",
            }}
          />
        )}
      </div>
    </div>
  );
}
