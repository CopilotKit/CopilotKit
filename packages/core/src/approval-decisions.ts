import { z } from "zod";

const snapshotSchema = z.object({
  version: z.literal(1),
  decisions: z
    .array(
      z.object({
        requestId: z.string().min(1),
        toolCallId: z.string().min(1),
        approved: z.boolean(),
        status: z.literal("waiting"),
      }),
    )
    .superRefine((decisions, context) => {
      if (
        new Set(decisions.map((d) => d.requestId)).size !== decisions.length ||
        new Set(decisions.map((d) => d.toolCallId)).size !== decisions.length
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate approval decision identity",
        });
    }),
});

/** A native saved-head decision projection, or an explicit unavailable marker. */
export type ApprovalDecisions =
  | z.infer<typeof snapshotSchema>
  | { error: true };

/** Validate the shared cpki.approval_decisions v1 event without inventing a result. */
export function parseApprovalDecisions(value: unknown): ApprovalDecisions {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : { error: true };
}
