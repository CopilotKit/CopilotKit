import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { createLitComponent } from "../../adapter";
import { renderChildList } from "../children";
import { mapAlign, mapJustify } from "./utils";

export const ColumnSchema = z.object({
  children: CommonSchemas.ChildList,
  justify: z
    .enum([
      "start",
      "center",
      "end",
      "spaceBetween",
      "spaceAround",
      "spaceEvenly",
      "stretch",
    ])
    .optional(),
  align: z.enum(["center", "end", "start", "stretch"]).optional(),
});

export const ColumnApiDef = {
  name: "Column",
  schema: ColumnSchema,
};

export const Column = createLitComponent(
  ColumnApiDef,
  ({ props, buildChild }) => html`
    <div
      style=${styleMap({
        display: "flex",
        flexDirection: "column",
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        gap: "8px",
      })}
    >
      ${renderChildList(props.children, buildChild)}
    </div>
  `,
);
