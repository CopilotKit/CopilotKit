import { z } from "zod";

// One pin on the map. The descriptions help the model fill these in correctly.
export const markerSchema = z.object({
  lat: z.number().describe("Latitude"),
  lng: z.number().describe("Longitude"),
  title: z.string().describe("Marker title"),
  description: z.string().optional().describe("Marker description"),
  color: z.enum(["red", "blue", "green", "orange", "purple"]).optional(),
});

// The whole map: where to look, how close, and what to pin.
export const mapSchema = z.object({
  title: z.string().optional().describe("Map title"),
  center: z.object({ lat: z.number(), lng: z.number() }).describe("Map center"),
  zoom: z
    .number()
    .min(1)
    .max(18)
    .describe("Zoom level (1 = world, 18 = building)"),
  markers: z
    .array(markerSchema)
    .describe("Markers to draw. Always send the complete set."),
});

export type MapState = z.infer<typeof mapSchema>;
export type Marker = z.infer<typeof markerSchema>;
