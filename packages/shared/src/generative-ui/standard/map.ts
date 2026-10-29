import { z } from "zod";

// ---- Schema ----

export const mapMarker = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  category: z.string().optional(),
  icon: z.string().optional(),
});
export type MapMarker = z.output<typeof mapMarker>;

export const mapSchema = z.object({
  markers: z
    .array(mapMarker)
    .optional()
    .describe('A list of places, or { "@path": "/x" }'),
  route: z
    .boolean()
    .optional()
    .describe("Draws a line through the markers in order"),
  selected: z
    .string()
    .optional()
    .describe(
      'The label of the selected marker. Bind it with { "@path": "/x" } to read the choice of the user',
    ),
  height: z.number().optional().describe("Pixels. Default 240"),
  zoom: z
    .number()
    .optional()
    .describe("With two or more markers, only the highest zoom of the fit"),
  center: z.object({ lat: z.number(), lng: z.number() }).optional(),
});
