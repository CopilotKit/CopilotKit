import { z } from "zod";

/**
 * Validates `forwardedProps` for the `/compare` page. The customer drives
 * the list size from there; we require at least one product so the server
 * can always build the system prompt.
 *
 * Also pre-built.
 */
export const CompareForwardedProps = z.object({
  productIds: z.array(z.string().min(1)).min(1),
});
