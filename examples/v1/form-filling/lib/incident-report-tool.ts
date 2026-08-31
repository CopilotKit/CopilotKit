import { z } from "zod";
import { incidentDateSchema } from "./incident-date";

export const fillIncidentReportFormParameters = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .describe("The full name of the person reporting the incident"),
  email: z
    .string()
    .email()
    .describe("The email address of the person reporting the incident"),
  date: incidentDateSchema.describe(
    "The date of the incident in YYYY-MM-DD format",
  ),
  incidentType: z
    .enum([
      "phishing",
      "malware",
      "data_breach",
      "unauthorized_access",
      "ddos",
      "other",
    ])
    .describe("The type of incident"),
  incidentLevel: z
    .enum(["low", "medium", "high", "critical"])
    .describe("The severity of the incident"),
  incidentDescription: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .describe(
      "A detailed description of the incident with at least 10 characters",
    ),
  suggestedActions: z
    .string()
    .trim()
    .min(10, "Suggested actions must be at least 10 characters")
    .describe("Detailed suggested actions in a bulleted list"),
});
