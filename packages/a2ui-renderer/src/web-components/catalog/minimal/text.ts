import { html } from "lit";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { createLitComponent } from "../../adapter";

export const TextSchema = z.object({
  text: CommonSchemas.DynamicString,
  variant: z.enum(["h1", "h2", "h3", "h4", "h5", "caption", "body"]).optional(),
});

export const TextApiDef = {
  name: "Text",
  schema: TextSchema,
};

export const Text = createLitComponent(TextApiDef, ({ props }) => {
  const text = props.text ?? "";
  switch (props.variant) {
    case "h1":
      return html`<h1>${text}</h1>`;
    case "h2":
      return html`<h2>${text}</h2>`;
    case "h3":
      return html`<h3>${text}</h3>`;
    case "h4":
      return html`<h4>${text}</h4>`;
    case "h5":
      return html`<h5>${text}</h5>`;
    case "caption":
      return html`<small>${text}</small>`;
    case "body":
    default:
      return html`<span>${text}</span>`;
  }
});
