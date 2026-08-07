/**
 * Generative UI wiring: register a React renderer for each visual tool the
 * managed agent can call. CopilotKit matches TOOL_CALL events by name and
 * mounts the component inline in the transcript.
 *
 * The runtime delivers tool args untyped — numbers have arrived as strings
 * across @copilotkit/runtime versions — so each renderer parses its args
 * through a coercing zod schema before mounting the component, rather than
 * trusting the payload shape.
 */
import React from "react";
import {
  useConfigureSuggestions,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { GrowthProjection } from "./GrowthProjection";
import { ToolActivity } from "./ToolActivity";

// The tool schemas the agent sees (server/src/financialAssistantTools.ts) carry the numeric
// bounds; these zod shapes coerce and type the render props. The components
// still clamp and guard defensively, so an out-of-range value renders sensibly.
const growthSchema = z.object({
  title: z.string(),
  initialAmount: z.coerce.number().min(0),
  monthlyContribution: z.coerce.number().min(0),
  annualReturnPercent: z.coerce.number().min(0),
  years: z.coerce.number().min(1),
});

const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  <div className="viz-card viz-loading">{label}</div>
);

/** Parse-then-mount: loading row while streaming or when the args are unusable. */
const vizRender =
  <Args extends object>(
    schema: z.ZodType<Args>,
    loadingLabel: string,
    Component: React.ComponentType<Args>,
  ) =>
  (props: { status: string; parameters: unknown }) => {
    if (props.status === "inProgress")
      return <Placeholder label={loadingLabel} />;
    const parsed = schema.safeParse(asRecord(props.parameters));
    if (!parsed.success)
      return (
        <Placeholder label="This visual received numbers it could not read." />
      );
    return <Component {...parsed.data} />;
  };

/** Tool args have arrived in several shapes across CopilotKit versions: a
 *  typed object, an object with every number stringified, and an object whose
 *  nested arrays/objects are JSON strings. Normalize the structure here and
 *  let the schemas' z.coerce handle stringified leaf numbers. */
const asRecord = (parameters: unknown): unknown => {
  let value = parameters;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return parameters;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        parseStructured(field),
      ]),
    );
  }
  return value;
};

const parseStructured = (field: unknown): unknown => {
  if (typeof field !== "string") return field;
  const trimmed = field.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return field;
  try {
    return JSON.parse(trimmed);
  } catch {
    return field;
  }
};

/** Mount once inside CopilotKitProvider; renders nothing itself. */
export const VizToolRenderers: React.FC = () => {
  useConfigureSuggestions(
    {
      available: "always",
      suggestions: [
        {
          title: "Project monthly investing",
          message:
            "If I invest $500/month at a 7% annual return, what will I have in 20 years?",
        },
      ],
    },
    [],
  );

  useRenderTool(
    {
      name: "show_growth_projection",
      parameters: growthSchema,
      render: vizRender(
        growthSchema,
        "Building growth projection…",
        GrowthProjection,
      ),
    },
    [],
  );

  // Wildcard fallback: every other tool call (bash, web_search, file ops)
  // renders as a compact expandable activity row instead of disappearing.
  useRenderTool(
    {
      name: "*",
      render: (props) => (
        <ToolActivity
          name={props.name}
          status={props.status}
          args={props.parameters as Record<string, unknown> | undefined}
          result={typeof props.result === "string" ? props.result : undefined}
        />
      ),
    },
    [],
  );

  return null;
};
