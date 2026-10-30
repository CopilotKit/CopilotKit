import { z } from "zod";
import { child, childList, def } from "./shared";

/**
 * Column, Row, Grid, Card, Tabs, Divider and Carousel come from the Gen UI 2.0
 * standard catalog (`standardUI`); these are the layouts it does not have.
 */

export const layoutDefinitions = {
  Section: def("Layout", "Titled group with eyebrow, title, description, and children.", z.object({ eyebrow: z.string().optional(), title: z.string(), description: z.string().optional(), children: childList() })),
  Accordion: def("Layout", "Collapsible items (FAQs, details, per-file notes); each has a title and either text or a child id.", z.object({ items: z.array(z.object({ title: z.string(), text: z.string().optional(), child: child().optional() })), multiple: z.boolean().optional() })),
};
