import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { IncidentReportForm } from "./IncidentReportForm";

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn(),
  useFrontendTool: vi.fn(),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}));

it("marks the calendar trigger as a non-submit button", () => {
  const markup = renderToStaticMarkup(<IncidentReportForm />);
  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const calendarTrigger = buttons.find((button) =>
    button.includes("Pick a date"),
  );

  expect(calendarTrigger).toBeDefined();
  expect(calendarTrigger).toContain('type="button"');
});
