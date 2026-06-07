/** Shared surface-scroll layout styles for A2UI tool and activity renderers. */
export const A2UI_SURFACE_SCROLL_STYLES = `
  :host {
    display: block;
    min-width: 0;
    max-width: 100%;
  }

  .copilot-a2ui-surface-scroll {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: visible;
    padding: 4px 0 8px;
  }

  .copilot-a2ui-surface-scroll cpk-a2ui-surface {
    display: block;
    min-width: 100%;
  }
`;
