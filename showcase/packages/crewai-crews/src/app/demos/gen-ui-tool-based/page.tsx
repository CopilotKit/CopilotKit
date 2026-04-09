"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotSidebar,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { DemoErrorBoundary } from "../error-boundary";

interface ResearchReport {
  title: string;
  sections: { heading: string; content: string }[];
  gradient: string;
}

export default function GenUiToolBasedDemo() {
  return (
    <DemoErrorBoundary demoName="Tool-Based Generative UI">
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
          <SidebarWithSuggestions />
          <ReportDisplay />
        </CopilotKit>
      </div>
    </DemoErrorBoundary>
  );
}

function SidebarWithSuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "AI Agents Report",
        message: "Generate a research report about AI agents.",
      },
      {
        title: "LLM Trends",
        message: "Create a report on the latest LLM trends.",
      },
      {
        title: "AI in Healthcare",
        message: "Research AI applications in healthcare.",
      },
    ],
    available: "always",
  });

  return (
    <CopilotSidebar
      defaultOpen={true}
      labels={{
        modalHeaderTitle: "Research Report Generator",
      }}
    />
  );
}

function ReportDisplay() {
  const [reports, setReports] = useState<ResearchReport[]>([
    {
      title: "AI Research Report",
      sections: [
        {
          heading: "Overview",
          content:
            "Ask the AI crew to research any topic and generate a detailed report.",
        },
      ],
      gradient: "linear-gradient(to bottom right, #f8fafc, #eff6ff)",
    },
  ]);

  useFrontendTool(
    {
      name: "generate_report",
      parameters: z.object({
        title: z.string().describe("Title of the research report"),
        sections: z
          .array(
            z.object({
              heading: z.string().describe("Section heading"),
              content: z.string().describe("Section content"),
            }),
          )
          .describe("Sections of the report"),
        gradient: z
          .string()
          .describe("CSS gradient for the report card background"),
      }),
      followUp: false,
      handler: async ({
        title,
        sections,
        gradient,
      }: {
        title: string;
        sections: { heading: string; content: string }[];
        gradient: string;
      }) => {
        const newReport: ResearchReport = {
          title: title || "Untitled Report",
          sections: sections || [],
          gradient: gradient || "",
        };
        setReports((prev) => [
          newReport,
          ...prev.filter(
            (r) =>
              r.sections[0]?.content !==
              "Ask the AI crew to research any topic and generate a detailed report.",
          ),
        ]);
        return "Report generated!";
      },
      render: ({ args }: { args: Partial<ResearchReport> }) => {
        if (!args.title) return <></>;
        return <ReportCard report={args as ResearchReport} />;
      },
    },
    [reports],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <div style={{ padding: "48px 80px", width: "100%", maxWidth: "56rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {reports.map((report, index) => (
            <ReportCard key={index} report={report} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: Partial<ResearchReport> }) {
  return (
    <div
      data-testid="report-card"
      style={{
        position: "relative",
        borderRadius: "16px",
        margin: "24px 0",
        padding: "32px",
        maxWidth: "42rem",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
        background:
          report.gradient ||
          "linear-gradient(to bottom right, #f8fafc, #eff6ff)",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <h2
          data-testid="report-title"
          style={{
            fontSize: "28px",
            fontWeight: 700,
            background: "linear-gradient(to right, #1e293b, #475569)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          {report.title}
        </h2>
        {report.sections?.map((section, index) => (
          <div
            key={index}
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
          >
            <h3
              style={{
                fontSize: "18px",
                fontWeight: 600,
                color: "#334155",
                margin: 0,
              }}
            >
              {section.heading}
            </h3>
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.7,
                color: "#64748b",
                margin: 0,
              }}
            >
              {section.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
