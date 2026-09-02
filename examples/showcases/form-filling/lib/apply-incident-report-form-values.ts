import type { UseFormSetValue } from "react-hook-form";
import type { IncidentReportFormValues } from "./incident-report-form";

/** Applies a complete agent update to the incident report form. */
export function applyIncidentReportFormValues(
  setValue: UseFormSetValue<IncidentReportFormValues>,
  values: IncidentReportFormValues,
) {
  const options = { shouldValidate: true };

  setValue("name", values.name, options);
  setValue("email", values.email, options);
  setValue("description", values.description, options);
  setValue("date", values.date, options);
  setValue("impactLevel", values.impactLevel, options);
  setValue("incidentType", values.incidentType, options);
  setValue("suggestedActions", values.suggestedActions, options);
}
