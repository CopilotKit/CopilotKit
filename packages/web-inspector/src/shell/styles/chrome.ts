import { css } from "lit";

import { shellContentStyles } from "./content.js";
import { shellLauncherStyles } from "./launcher.js";

export const shellChromeStyles = css`
      ${shellLauncherStyles}

      /* ── Inspector window ────────────────────────────────────────── */
      .inspector-window {
        border: 1px solid #d8d8e8 !important;
        border-radius: var(--cpk-inspector-shell-radius) !important;
        box-shadow: none !important;
      }

      /* ── Header drag area ────────────────────────────────────────── */
      .drag-handle {
        border-bottom-color: #d8d8e8 !important;
        background-color: #f7f6fd !important;
      }

      .inspector-account-strip {
        background: #f7f6fd !important;
        color: #010507 !important;
      }

      .inspector-window[data-color-scheme="dark"] .drag-handle,
      .inspector-window[data-color-scheme="dark"] .inspector-account-strip {
        background: #15171e !important;
      }

      /* ── Tab buttons ─────────────────────────────────────────────── */
      /*
       * Named classes owned by this component — no Tailwind conflict.
       * Active: brand surface/surfaceContainerActive (lilac tint) +
       *         border/borderActionEnabled underline.
       * Dark fill is for primary action buttons only, not nav tabs.
       */
      .cpk-tab-active {
        background-color: rgba(190, 194, 255, 0.18);
        color: #010507;
        font-weight: 600;
      }
      .cpk-tab-icon {
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
      }
      .cpk-tab-active .cpk-tab-icon {
        color: #5558b2;
      }
      .cpk-tab-inactive {
        background-color: transparent;
        color: #2b2b2b;
      }
      .cpk-tab-inactive .cpk-tab-icon {
        color: #68686e;
      }
      .cpk-tab-inactive:hover {
        background-color: rgba(190, 194, 255, 0.08);
        color: #010507;
        cursor: pointer;
      }
      .cpk-tab-active {
        cursor: pointer;
      }
      /* ── Header controls on the branded account strip ──────────── */
      .drag-handle > div[data-inspector-account-strip] button {
        color: #57575b !important;
        cursor: pointer;
      }
      .drag-handle > div[data-inspector-account-strip] button,
      .inspector-nav-control,
      [data-inspector-thread-cta] {
        outline: 2px solid transparent;
        outline-offset: 2px;
      }
      .drag-handle > div[data-inspector-account-strip] button:hover {
        background-color: rgba(100, 48, 171, 0.09) !important;
        color: #3f176f !important;
      }
      .drag-handle > div[data-inspector-account-strip] button:focus-visible {
        outline: 2px solid #bec2ff !important;
        outline-offset: 2px;
      }
      .inspector-nav-control:focus-visible,
      [data-inspector-thread-cta]:focus-visible,
      [data-inspector-action-placement="threads-footer"]:focus-visible {
        outline: 2px solid #6430ab !important;
        outline-offset: 2px;
      }
      .inspector-sidebar .inspector-nav-control,
      .inspector-sidebar .inspector-sidebar-control,
      .inspector-sidebar .inspector-sidebar-label {
        display: flex !important;
        justify-content: flex-start !important;
        text-align: left !important;
        outline-offset: -2px;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-control,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-control,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-toggle {
        box-sizing: border-box !important;
        width: 36px !important;
        height: 36px !important;
        min-width: 36px !important;
        min-height: 36px !important;
        justify-content: center !important;
        align-items: center !important;
        gap: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-icon,
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-icon svg,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-icon,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-icon
        svg,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-placeholder
        svg {
        width: 18px !important;
        height: 18px !important;
        overflow: visible !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-selector
        > [data-context-dropdown-root="true"] {
        display: flex !important;
        flex: none !important;
        width: 36px !important;
        min-width: 36px !important;
        max-width: 36px !important;
        justify-content: center !important;
        align-items: center !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button,
      .inspector-sidebar[data-icon-rail="true"] .inspector-agent-placeholder {
        display: flex !important;
        width: 36px !important;
        height: 36px !important;
        min-width: 36px !important;
        min-height: 36px !important;
        max-width: 36px !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 0 !important;
        padding: 0 !important;
        transition:
          background-color 180ms ease,
          border-color 180ms ease,
          color 180ms ease !important;
      }
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-label,
      .inspector-sidebar[data-icon-rail="true"]
        .inspector-context-dropdown-chevron {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
        flex: none !important;
        overflow: hidden !important;
      }
      .inspector-sidebar[data-icon-rail="true"] .inspector-nav-label,
      .inspector-sidebar[data-icon-rail="true"] .inspector-sidebar-label {
        display: none !important;
      }
      .inspector-sidebar .inspector-nav-control:focus-visible,
      .inspector-sidebar .inspector-sidebar-label:focus-visible,
      .inspector-sidebar .inspector-sidebar-toggle:focus-visible {
        outline-offset: -2px !important;
      }

      ${shellContentStyles}
`;
