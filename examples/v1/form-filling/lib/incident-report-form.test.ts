import { expect, test } from "vitest";
import { incidentReportFormSchema } from "./incident-report-form";

function setup() {
  return {
    input: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      incidentType: "phishing",
      date: new Date(2026, 7, 31),
      description: "A suspicious message requested account access.",
      impactLevel: "high",
      suggestedActions: "Reset the password and review account activity.",
    },
  };
}

test("rejects a full name containing only whitespace", () => {
  const { input } = setup();

  const result = incidentReportFormSchema.safeParse({
    ...input,
    name: "  ",
  });

  expect(result.success).toBe(false);
});

test("rejects an incident description containing only whitespace", () => {
  const { input } = setup();

  const result = incidentReportFormSchema.safeParse({
    ...input,
    description: "          ",
  });

  expect(result.success).toBe(false);
});

test("rejects suggested actions containing only whitespace", () => {
  const { input } = setup();

  const result = incidentReportFormSchema.safeParse({
    ...input,
    suggestedActions: "          ",
  });

  expect(result.success).toBe(false);
});
