import { CpkA2uiBoundComponent } from "./bound-component";
import { CpkA2uiNode } from "./node";
import { CpkA2uiSurface } from "./surface";

export const CPK_A2UI_SURFACE_TAG = "cpk-a2ui-surface";
export const CPK_A2UI_NODE_TAG = "cpk-a2ui-node";
export const CPK_A2UI_BOUND_COMPONENT_TAG = "cpk-a2ui-bound-component";

export function defineA2UIWebComponents(): void {
  if (!customElements.get(CPK_A2UI_BOUND_COMPONENT_TAG)) {
    customElements.define(CPK_A2UI_BOUND_COMPONENT_TAG, CpkA2uiBoundComponent);
  }
  if (!customElements.get(CPK_A2UI_NODE_TAG)) {
    customElements.define(CPK_A2UI_NODE_TAG, CpkA2uiNode);
  }
  if (!customElements.get(CPK_A2UI_SURFACE_TAG)) {
    customElements.define(CPK_A2UI_SURFACE_TAG, CpkA2uiSurface);
  }
}

export { CpkA2uiSurface, CpkA2uiNode, CpkA2uiBoundComponent };

declare global {
  interface HTMLElementTagNameMap {
    "cpk-a2ui-surface": CpkA2uiSurface;
    "cpk-a2ui-node": CpkA2uiNode;
    "cpk-a2ui-bound-component": CpkA2uiBoundComponent;
  }
}
