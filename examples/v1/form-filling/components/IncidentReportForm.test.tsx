import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { applyIncidentReportFormValues } from "@/lib/apply-incident-report-form-values";
import { serializeIncidentDate } from "@/lib/incident-date";
import { prompt } from "@/lib/prompt";
import { IncidentReportForm } from "./IncidentReportForm";

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn(),
  useFrontendTool: vi.fn(),
}));

vi.mock("@/lib/apply-incident-report-form-values", () => ({
  applyIncidentReportFormValues: vi.fn(),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}));

test("marks the calendar trigger as a non-submit button", () => {
  const markup = renderToStaticMarkup(<IncidentReportForm />);
  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const calendarTrigger = buttons.find((button) =>
    button.includes("Pick a date"),
  );

  expect(calendarTrigger).toBeDefined();
  expect(calendarTrigger).toContain('type="button"');
});

/** Captures the actual registered tool handler without invoking a model. */
function setupTool() {
  vi.clearAllMocks();
  renderToStaticMarkup(<IncidentReportForm />);
  const tool = vi.mocked(useFrontendTool).mock.calls[0]?.[0];
  if (!tool?.handler) throw new Error("Missing incident report tool handler");
  const action = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    date: "2020-01-01",
    incidentType: "phishing",
    incidentLevel: "high",
    incidentDescription: "A suspicious email requested account access.",
    suggestedActions: "Reset the password and check account activity.",
  };
  const handler = tool.handler;
  return {
    handler: (input: Record<string, unknown>) =>
      handler(input, {
        toolCall: {
          id: "fill-form",
          type: "function",
          function: {
            name: "fillIncidentReportForm",
            arguments: JSON.stringify(input),
          },
        },
      }),
    action,
  };
}

test.each([
  { fullName: "A" },
  { incidentLevel: "unknown" },
  { incidentType: "unknown" },
  { date: "9999-01-01" },
  { date: "2020-02-30" },
  { incidentDescription: "  " },
])("invalid tool arguments %j never update the form", async (invalid) => {
  const { handler, action } = setupTool();

  const result = await handler({ ...action, ...invalid });

  expect(result).not.toBe("Updated the incident report form.");
  expect(applyIncidentReportFormValues).not.toHaveBeenCalled();
});

test("the tool applies parsed values after validation", async () => {
  const { handler, action } = setupTool();

  expect(await handler({ ...action, fullName: "  Ada Lovelace  " })).toBe(
    "Updated the incident report form.",
  );

  expect(applyIncidentReportFormValues).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({
      name: "Ada Lovelace",
      date: new Date(2020, 0, 1),
      impactLevel: "high",
    }),
  );
});

test("the browser supplies today's calendar date through agent context", () => {
  setupTool();

  expect(vi.mocked(useAgentContext).mock.calls).toContainEqual([
    expect.objectContaining({
      description: "Today's date in the user's local time zone (YYYY-MM-DD)",
      value: serializeIncidentDate(new Date()),
    }),
  ]);
  expect(prompt).not.toMatch(/Today is \d/);
});
