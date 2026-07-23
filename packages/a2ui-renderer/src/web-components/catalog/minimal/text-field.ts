import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import { createLitComponent } from "../../adapter";

export const TextFieldSchema = z.object({
  label: CommonSchemas.DynamicString,
  value: CommonSchemas.DynamicString,
  variant: z.enum(["longText", "number", "shortText", "obscured"]).optional(),
  validationRegexp: z.string().optional(),
});

export const TextFieldApiDef = {
  name: "TextField",
  schema: TextFieldSchema,
};

export const TextField = createLitComponent(
  TextFieldApiDef,
  ({ props, context }) => {
    const isLong = props.variant === "longText";
    const type =
      props.variant === "number"
        ? "number"
        : props.variant === "obscured"
          ? "password"
          : "text";
    const id = `textfield-${context.componentModel.id}`;
    const style = {
      padding: "8px",
      width: "100%",
      border: "1px solid #ccc",
      borderRadius: "4px",
      boxSizing: "border-box",
    };
    const onChange = (event: Event) => {
      props.setValue?.(
        (event.target as HTMLInputElement | HTMLTextAreaElement).value,
      );
    };

    return html`
      <div
        style=${styleMap({
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          width: "100%",
        })}
      >
        ${
          props.label
            ? html`<label
              for=${id}
              style=${styleMap({ fontSize: "14px", fontWeight: "bold" })}
              >${props.label}</label
            >`
            : null
        }
        ${
          isLong
            ? html`<textarea
              id=${id}
              style=${styleMap(style)}
              .value=${props.value || ""}
              @input=${onChange}
            ></textarea>`
            : html`<input
              id=${id}
              type=${type}
              style=${styleMap(style)}
              .value=${props.value || ""}
              @input=${onChange}
            />`
        }
      </div>
    `;
  },
);
