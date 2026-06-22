import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { ModalApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";

export const Modal = createLitComponent(
  ModalApi,
  ({ props, buildChild, state, requestUpdate }) => {
    const local = state as { isOpen: boolean };
    return html`
      <div
        @click=${() => {
          local.isOpen = true;
          requestUpdate();
        }}
        style="display: inline-block;"
      >
        ${props.trigger ? buildChild(props.trigger) : nothing}
      </div>
      ${
        local.isOpen
          ? html`
            <div
              style=${styleMap({
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                bottom: "0",
                backgroundColor: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: "1000",
              })}
              @click=${() => {
                local.isOpen = false;
                requestUpdate();
              }}
            >
              <div
                style=${styleMap({
                  backgroundColor: "#fff",
                  padding: "24px",
                  borderRadius: "8px",
                  maxWidth: "90%",
                  maxHeight: "90%",
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                })}
                @click=${(e: Event) => e.stopPropagation()}
              >
                <div style="display: flex; justify-content: flex-end;">
                  <button
                    type="button"
                    @click=${() => {
                      local.isOpen = false;
                      requestUpdate();
                    }}
                    style=${styleMap({
                      border: "none",
                      background: "none",
                      fontSize: "20px",
                      cursor: "pointer",
                      padding: "4px",
                    })}
                  >
                    &times;
                  </button>
                </div>
                <div style="flex: 1;">
                  ${props.content ? buildChild(props.content) : nothing}
                </div>
              </div>
            </div>
          `
          : nothing
      }
    `;
  },
  () => ({ isOpen: false }),
);
