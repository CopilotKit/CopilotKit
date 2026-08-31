import { expect, test } from "vitest";
import { fillIncidentReportFormParameters } from "./incident-report-tool";

function setup() {
  return {
    input: {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      date: "2026-08-31",
      incidentType: "phishing",
      incidentLevel: "high",
      incidentDescription: "A suspicious message requested account access.",
      suggestedActions: "Reset the password and review account activity.",
    },
  };
}

test("accepts a report that satisfies the form constraints", () => {
  const { input } = setup();

  expect(fillIncidentReportFormParameters.safeParse(input).success).toBe(true);
});

test("rejects a full name shorter than the form minimum", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    fullName: "A",
  });

  expect(result.success).toBe(false);
});

test("rejects an incident description shorter than the form minimum", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    incidentDescription: "Too short",
  });

  expect(result.success).toBe(false);
});

test("rejects suggested actions shorter than the form minimum", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    suggestedActions: "Too short",
  });

  expect(result.success).toBe(false);
});

test("rejects a full name containing only whitespace", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    fullName: "  ",
  });

  expect(result.success).toBe(false);
});

test("rejects an incident description containing only whitespace", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    incidentDescription: "          ",
  });

  expect(result.success).toBe(false);
});

test("rejects suggested actions containing only whitespace", () => {
  const { input } = setup();

  const result = fillIncidentReportFormParameters.safeParse({
    ...input,
    suggestedActions: "          ",
  });

  expect(result.success).toBe(false);
});
