import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { createLitComponent } from "../../adapter";

export const ButtonSchema = z.object({
  child: CommonSchemas.ComponentId,
  action: CommonSchemas.Action,
  variant: z.enum(["primary", "borderless"]).optional(),
});

export const ButtonApiDef = {
  name: "Button",
  schema: ButtonSchema,
};

export const Button = createLitComponent(
  ButtonApiDef,
  ({ props, buildChild }) => html`
    <button
      type="button"
      style=${styleMap({
        padding: "8px 16px",
        cursor: "pointer",
        border: props.variant === "borderless" ? "none" : "1px solid #ccc",
        backgroundColor:
          props.variant === "primary" ? "#007bff" : "transparent",
        color: props.variant === "primary" ? "#fff" : "inherit",
        borderRadius: "4px",
      })}
      @click=${() => props.action?.()}
    >
      ${props.child ? buildChild(props.child) : null}
    </button>
  `,
);
