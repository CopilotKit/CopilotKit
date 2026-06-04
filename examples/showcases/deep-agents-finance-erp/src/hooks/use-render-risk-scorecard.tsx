"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RiskDimension {
  name: string;
  score: number;
  status: "healthy" | "warning" | "critical";
  detail: string;
  suggestion: string;
}

function RiskRing({ score: rawScore, size = 56 }: { score: number; size?: number }) {
  const score = rawScore || 0;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color =
    score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        className="text-muted/20"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={14}
        fontWeight="bold"
        className="transform rotate-90"
        style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
      >
        {score}
      </text>
    </svg>
  );
}

function RiskScorecardComponent({ dimensions, overallScore, summary }: {
  dimensions: RiskDimension[];
  overallScore: number;
  summary: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const overallColor =
    overallScore >= 75 ? "text-emerald-500" : overallScore >= 50 ? "text-amber-500" : "text-red-500";
  const overallBg =
    overallScore >= 75 ? "bg-emerald-500/5 border-emerald-500/20" : overallScore >= 50 ? "bg-amber-500/5 border-amber-500/20" : "bg-red-500/5 border-red-500/20";
  const overallLabel =
    overallScore >= 75 ? "Healthy" : overallScore >= 50 ? "Needs Attention" : "At Risk";

  return (
    <div className="space-y-3 w-full">
      {/* Overall Score */}
      <Card className={`w-full ${overallBg}`}>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <RiskRing score={overallScore} size={72} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold">Financial Health</h3>
                <span className={`text-sm font-semibold ${overallColor}`}>{overallLabel}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{summary}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dimensions */}
      {dimensions.map((dim, i) => {
        const isExpanded = expanded === dim.name;
        const statusIcon =
          dim.status === "healthy" ? "✅" : dim.status === "warning" ? "⚠️" : "🔴";

        return (
          <Card
            key={`${dim.name}-${i}`}
            className="w-full cursor-pointer transition-all hover:shadow-sm border-border/50"
            onClick={() => setExpanded(isExpanded ? null : dim.name)}
          >
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <RiskRing score={dim.score} size={44} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{statusIcon}</span>
                    <h4 className="text-sm font-medium truncate">{dim.name}</h4>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                      <p className="text-xs text-muted-foreground">{dim.detail}</p>
                      <p className="text-xs font-medium text-primary">💡 {dim.suggestion}</p>
                    </div>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function useRenderRiskScorecard() {
  useRenderTool(
    {
      name: "render_risk_scorecard",
      render: ({ args }: any) => {
        if (!args?.dimensions) {
          return (
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 animate-pulse text-sm text-muted-foreground">
              Analyzing financial health...
            </div>
          );
        }

        return (
          <RiskScorecardComponent
            dimensions={args.dimensions}
            overallScore={args.overallScore || 0}
            summary={args.summary || ""}
          />
        );
      },
    } as any,
    [],
  );
}
