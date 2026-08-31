import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { createLitComponent } from "../../adapter";
import { renderChildList } from "../children";
import { mapAlign, mapJustify } from "./utils";

export const RowSchema = z.object({
  children: CommonSchemas.ChildList,
  justify: z
    .enum([
      "center",
      "end",
      "spaceAround",
      "spaceBetween",
      "spaceEvenly",
      "start",
      "stretch",
    ])
    .optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
});

export const RowApiDef = {
  name: "Row",
  schema: RowSchema,
};

export const Row = createLitComponent(
  RowApiDef,
  ({ props, buildChild }) => html`
  <div
    style=${styleMap({
      display: "flex",
      flexDirection: "row",
      justifyContent: mapJustify(props.justify),
      alignItems: mapAlign(props.align),
    })}
  >
    ${renderChildList(props.children, buildChild)}
  </div>
`,
);
