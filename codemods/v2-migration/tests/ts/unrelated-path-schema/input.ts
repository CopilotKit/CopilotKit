import { z } from "zod";

// A tool schema that takes a file path: not an A2UI binding.
export const readFile = z.object({ path: z.string() });
export const headers = z.record(z.string());
