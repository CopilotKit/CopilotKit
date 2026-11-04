"use client";

import type { DiscourseReport } from "@/lib/discourse";

/**
 * grok's read on the discourse, above the charts.
 *
 * This is the one panel that is allowed to be prose. Everything below it is
 * structure — the split, the arguments, the posts. Putting the sentence first
 * means you know what you're looking at before you start reading bars.
 */
export default function Summary({ report }: { report: DiscourseReport }) {
  if (!report.summary) return null;

  return (
    <div style={{ padding: "14px 18px 16px" }}>
      <div className="section-title" style={{ marginBottom: 10 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--agent)",
            flexShrink: 0,
          }}
        />
        <span className="label">grok-4.6 · read</span>
        <div className="rule" />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {report.postsScanned} posts · {report.window}
        </span>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.5,
          letterSpacing: "-0.011em",
          color: "var(--text-1)",
        }}
      >
        {report.summary}
      </p>
    </div>
  );
}
