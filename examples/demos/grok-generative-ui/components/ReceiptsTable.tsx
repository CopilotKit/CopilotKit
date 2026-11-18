"use client";

import XPost from "./XPost";
import type { DiscourseReport } from "@/lib/discourse";

/**
 * The post feed. Every post the model cited, rendered as itself rather than
 * summarised into a row — the whole claim of the demo is that these are real, so
 * they get the space to look real. The column scrolls; nothing is truncated.
 */
export default function ReceiptsTable({ report }: { report: DiscourseReport }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
    >
      <div
        className="section-title"
        style={{ padding: "18px 20px 12px", flexShrink: 0 }}
      >
        <span className="label">Posts</span>
        <div className="rule" />
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {report.posts.length} cited
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {report.posts.map((p, i) => (
          <XPost key={p.id} post={p} last={i === report.posts.length - 1} />
        ))}
      </div>
    </div>
  );
}
