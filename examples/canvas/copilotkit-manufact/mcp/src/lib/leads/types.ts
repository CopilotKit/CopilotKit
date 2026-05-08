import { z } from "zod";

export const STATUSES = ["Not started", "In progress", "Done"] as const;
export type LeadStatus = (typeof STATUSES)[number];

export const WORKSHOPS = [
  "Agentic UI (AG-UI)",
  "MCP Apps / Tooling",
  "RAG & Data Chat",
  "Evaluations & Guardrails",
  "Deploying Agents (prod)",
  "Not sure yet",
] as const;
export type Workshop = (typeof WORKSHOPS)[number];

export const TECH_LEVELS = [
  "Non-technical",
  "Some technical",
  "Developer",
  "Advanced / expert",
] as const;
export type TechLevel = (typeof TECH_LEVELS)[number];

export const SEGMENT_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "slate",
] as const;
export type SegmentColor = (typeof SEGMENT_COLORS)[number];

export const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  company: z.string().default(""),
  role: z.string().default(""),
  workshop: z.string(),
  technical_level: z.string(),
  tools: z.array(z.string()).default([]),
  status: z.string().default("Not started"),
  opt_in: z.boolean().default(false),
});

export type Lead = z.infer<typeof leadSchema>;

export const segmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.enum(SEGMENT_COLORS).optional(),
  leadIds: z.array(z.string()).default([]),
});

export type Segment = z.infer<typeof segmentSchema>;
