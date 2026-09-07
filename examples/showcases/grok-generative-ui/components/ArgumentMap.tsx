"use client";

import type { Argument, DiscourseReport } from "@/lib/discourse";

function Column({
  label,
  stance,
  args,
  max,
}: {
  label: string;
  stance: "bull" | "bear";
  args: Argument[];
  max: number;
}) {
  const color = stance === "bull" ? "var(--bull)" : "var(--bear)";
  const wash = stance === "bull" ? "var(--bull-wash)" : "var(--bear-wash)";

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: color,
          }}
        />
        <span className="label" style={{ color }}>
          {label}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {args.map((a, i) => (
          <div
            key={a.claim}
            style={{
              position: "relative",
              background: wash,
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "9px 12px",
              overflow: "hidden",
              animation: `fade-up 400ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 75}ms both`,
            }}
          >
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: "18px",
                marginBottom: 8,
                letterSpacing: "-0.01em",
              }}
            >
              {a.claim}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 2,
                  borderRadius: 9999,
                  background: "rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(a.support / max) * 100}%`,
                    height: "100%",
                    background: color,
                    transformOrigin: "left",
                    animation: `bar-grow 520ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 75 + 140}ms both`,
                  }}
                />
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--text-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {a.support}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArgumentMap({ report }: { report: DiscourseReport }) {
  const bull = report.arguments.filter((a) => a.stance === "bull");
  const bear = report.arguments.filter((a) => a.stance === "bear");
  const max = Math.max(...report.arguments.map((a) => a.support), 1);

  return (
    <div style={{ padding: "20px 22px" }}>
      <div className="section-title">
        <span className="label">Argument map</span>
        <div className="rule" />
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {bull.length > 0 && (
          <Column label="Bull case" stance="bull" args={bull} max={max} />
        )}
        {bear.length > 0 && (
          <Column label="Bear case" stance="bear" args={bear} max={max} />
        )}
      </div>
    </div>
  );
}
