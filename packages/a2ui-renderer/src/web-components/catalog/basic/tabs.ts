import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { TabsApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { createLitComponent } from "../../adapter";
import { LEAF_MARGIN } from "./utils";

export const Tabs = createLitComponent(
  TabsApi,
  ({ props, buildChild, state, requestUpdate }) => {
    const local = state as { selectedIndex: number };
    const tabs = props.tabs || [];
    const activeTab = tabs[local.selectedIndex] ?? tabs[0];
    return html`
      <div
        style=${styleMap({
          display: "flex",
          flexDirection: "column",
          width: "100%",
          margin: LEAF_MARGIN,
        })}
      >
        <div
          style=${styleMap({
            display: "flex",
            borderBottom: "1px solid #ccc",
            marginBottom: "8px",
          })}
        >
          ${tabs.map(
            (tab: any, i: number) => html`
              <button
                type="button"
                @click=${() => {
                  local.selectedIndex = i;
                  requestUpdate();
                }}
                style=${styleMap({
                  padding: "8px 16px",
                  border: "none",
                  background: "none",
                  borderBottom:
                    local.selectedIndex === i
                      ? "2px solid var(--a2ui-primary-color, #007bff)"
                      : "none",
                  fontWeight: local.selectedIndex === i ? "bold" : "normal",
                  cursor: "pointer",
                  color:
                    local.selectedIndex === i
                      ? "var(--a2ui-primary-color, #007bff)"
                      : "inherit",
                })}
              >
                ${tab.title}
              </button>
            `,
          )}
        </div>
        <div style="flex: 1;">
          ${activeTab ? buildChild(activeTab.child) : nothing}
        </div>
      </div>
    `;
  },
  () => ({ selectedIndex: 0 }),
);
