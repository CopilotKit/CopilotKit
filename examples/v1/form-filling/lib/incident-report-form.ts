import { z } from "zod";

export const incidentReportFormSchema = z.object({
  name: z.string().trim().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  incidentType: z.string({
    required_error: "Please select an incident type.",
  }),
  date: z.date({
    required_error: "Please select the date when the incident occurred.",
  }),
  description: z.string().trim().min(10, {
    message: "Description must be at least 10 characters.",
  }),
  impactLevel: z.string({
    required_error: "Please select an impact level.",
  }),
  suggestedActions: z.string().trim().min(10, {
    message: "Suggested actions must be at least 10 characters.",
  }),
});

export type IncidentReportFormValues = z.infer<typeof incidentReportFormSchema>;
