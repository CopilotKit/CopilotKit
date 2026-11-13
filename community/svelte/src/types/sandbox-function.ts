import type { z } from "zod";

export interface SandboxFunction {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown> | unknown;
}
