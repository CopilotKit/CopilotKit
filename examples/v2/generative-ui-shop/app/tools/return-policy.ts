import { toolDefinition } from "#app/tools/tool-definition.ts";
import { z } from "zod";

const ReturnPolicyOutput = z.object({
  policy: z.string(),
});

const RETURN_POLICY =
  'EpicStore accepts returns within 30 days of delivery for a full refund, provided items are unworn, unwashed, and in their original packaging with tags attached. Return shipping is free for US orders — print a prepaid label from your account. Sale items marked "final sale" are not eligible. Refunds typically post to your original payment method within 5–7 business days of receiving the return.';

const getReturnPolicyDef = toolDefinition({
  name: "getReturnPolicy",
  description:
    "Get EpicStore's return and refund policy. Use this when the customer asks about returns, refunds, exchanges, or how long they have to send something back.",
  inputSchema: z.object({}),
  outputSchema: ReturnPolicyOutput,
  lazy: true,
});

export const getReturnPolicy = getReturnPolicyDef.server(() => ({
  policy: RETURN_POLICY,
}));
