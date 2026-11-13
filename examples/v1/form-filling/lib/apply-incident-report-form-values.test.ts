import { zodResolver } from "@hookform/resolvers/zod";
import { createFormControl } from "react-hook-form";
import { expect, test, vi } from "vitest";
import { applyIncidentReportFormValues } from "./apply-incident-report-form-values";
import { incidentReportFormSchema } from "./incident-report-form";
import type { IncidentReportFormValues } from "./incident-report-form";

const fieldNames = [
  "name",
  "email",
  "incidentType",
  "date",
  "description",
  "impactLevel",
  "suggestedActions",
] as const satisfies readonly (keyof IncidentReportFormValues)[];

function createValidIncidentReport(): IncidentReportFormValues {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    incidentType: "phishing",
    date: new Date(2026, 7, 31),
    description: "A suspicious message requested account access.",
    impactLevel: "high",
    suggestedActions: "Reset the password and review account activity.",
  };
}

test("agent updates revalidate every field and clear stale errors", async () => {
  const form = createFormControl<IncidentReportFormValues>({
    resolver: zodResolver(incidentReportFormSchema),
  });

  for (const fieldName of fieldNames) {
    form.register(fieldName);
    form.setError(fieldName, {
      type: "manual",
      message: "Stale validation error",
    });
  }

  applyIncidentReportFormValues(form.setValue, createValidIncidentReport());

  await vi.waitFor(() => {
    for (const fieldName of fieldNames) {
      expect(form.getFieldState(fieldName).error).toBeUndefined();
    }
  });
});
