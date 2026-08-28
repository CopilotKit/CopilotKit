import { css } from "lit";

export const homeViewStyles = css`
  .inspector-home {
    position: relative;
    min-height: 100%;
    padding: 30px 32px 40px;
    overflow: auto;
    background-color: #ffffff;
  }
  .inspector-home::before {
    display: none;
  }
  .inspector-home > * {
    width: min(100%, 960px);
    margin-right: auto;
    margin-left: auto;
  }
  .inspector-home-card {
    position: relative;
    border: 1px solid #deddea;
    border-radius: 5px;
    background-color: rgba(255, 255, 255, 0.82);
    padding: 18px 18px 16px;
  }
  .inspector-home-eyebrow,
  .inspector-home-card-label,
  .inspector-home-meta {
    margin: 0;
    color: #57575b;
    font-size: 12px;
    font-weight: 600;
  }
  .inspector-home-title,
  .inspector-home-section-title,
  .inspector-home-card-title {
    margin: 8px 0 0;
    color: #010507;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.15;
  }
  .inspector-home-section-title {
    margin: 0 0 14px;
    font-size: 17px;
    letter-spacing: -0.015em;
  }
  .inspector-home-card-title {
    font-size: 16px;
  }
  .inspector-home-body,
  .inspector-home-card-copy {
    margin: 10px 0 0;
    max-width: 52ch;
    color: #57575b;
    font-size: 15px;
    line-height: 1.5;
  }
  .inspector-home-section {
    position: relative;
    margin-top: 24px;
  }
  .inspector-home > .inspector-home-section:first-child {
    margin-top: 0;
  }
  .inspector-home-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }
  .inspector-home-section-header .inspector-home-section-title {
    margin-bottom: 0;
  }
  .inspector-home-section-header > span {
    color: #68686e;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
  }
  .inspector-system-health-header > span[data-tone="success"] {
    color: #087653;
  }
  .inspector-system-health-header > span[data-tone="checking"] {
    color: #8a5900;
  }
  .inspector-system-health-header > span[data-tone="off\\6cine"],
  .inspector-system-health-header > span[data-tone="error"] {
    color: #b32d3b;
  }
  .inspector-system-health-section {
    overflow: hidden;
    border: 1px solid #c8c6e6;
    border-radius: 5px;
    background-color: #f7f4fe;
  }
  .inspector-system-health-section .inspector-system-health-header {
    min-height: 76px;
    align-items: center;
    margin: 0;
    border-bottom: 1px solid #d5d3e4;
    background-color: #f7f4fe;
    padding: 18px;
  }
  .inspector-system-health-heading {
    min-width: 0;
  }
  .inspector-system-health-heading .inspector-home-section-title {
    color: #010507;
    font-size: 18px;
    letter-spacing: -0.025em;
  }
  .inspector-system-health-state,
  .inspector-intelligence-hud-state {
    display: inline-flex;
    min-height: 24px;
    flex: none;
    align-items: center;
    gap: 6px;
    border: 1px solid #85d3bb;
    border-radius: 999px;
    background-color: #e5f7f1;
    padding: 4px 8px;
    color: #087653;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .inspector-system-health-state > span,
  .inspector-intelligence-hud-state > span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background-color: currentColor;
  }
  .inspector-system-health-state[data-tone="checking"],
  .inspector-intelligence-hud-state[data-tone="checking"] {
    border-color: #dfc08f;
    background-color: #fff5df;
    color: #7d4d0a !important;
  }
  .inspector-system-health-state[data-tone="off\\6cine"],
  .inspector-system-health-state[data-tone="error"],
  .inspector-intelligence-hud-state[data-tone="off\\6cine"],
  .inspector-intelligence-hud-state[data-tone="error"] {
    border-color: #e7a7ac;
    background-color: #fff0f1;
    color: #b32d3b !important;
  }
  .inspector-system-health-state[data-tone="unavailable"],
  .inspector-intelligence-hud-state[data-tone="unavailable"] {
    border-color: #c8c8d2;
    background-color: #f0f0f4;
    color: #57575b !important;
  }
  .inspector-system-health {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    background-color: #d5d3e4;
  }
  .inspector-system-health-signal {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    align-items: start;
    min-height: 84px;
    background-color: #ffffff;
    padding: 15px 16px 14px;
  }
  .inspector-system-health-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  .inspector-system-health-signal dt {
    color: #68686e;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.035em;
    line-height: 1.3;
    text-transform: uppercase;
  }
  .inspector-system-health-signal dd {
    min-width: 0;
    margin: 5px 0 0;
    overflow: hidden;
    color: #010507;
    font-size: 15px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-system-health-signal small {
    min-width: 0;
    margin-top: 4px;
    overflow: hidden;
    color: #68686e;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small.inspector-system-health-detail {
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.4;
  }
  .inspector-system-health-url {
    position: relative;
    overflow: visible !important;
    cursor: help;
    outline: none;
  }
  .inspector-system-health-url > span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-system-health-url::after {
    position: absolute;
    bottom: calc(100% + 7px);
    left: 0;
    z-index: 30;
    width: max-content;
    max-width: min(360px, 70vw);
    border: 1px solid #3a3d49;
    border-radius: 4px;
    background-color: #15171e;
    padding: 7px 9px;
    color: #f3f4f8;
    box-shadow: 0 8px 20px rgba(1, 5, 7, 0.18);
    content: attr(data-full-value);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.45;
    opacity: 0;
    overflow-wrap: anywhere;
    pointer-events: none;
    transform: translateY(3px);
    transition:
      opacity 120ms ease,
      transform 120ms ease;
    white-space: normal;
  }
  .inspector-system-health-url:hover::after,
  .inspector-system-health-url:focus-visible::after {
    opacity: 1;
    transform: translateY(0);
  }
  .inspector-system-health-url:focus-visible > span {
    border-radius: 3px;
    outline: 2px solid #6430ab;
    outline-offset: 2px;
  }
  .inspector-system-health-signal[data-tone="success"] dd {
    color: #087653;
  }
  .inspector-system-health-signal[data-tone="active"] dd {
    color: #8a5900;
  }
  .inspector-system-health-event-link {
    display: block;
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .inspector-system-health-event-link > span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-system-health-event-link > .inspector-system-health-event-type {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    align-items: center;
    border-radius: 999px;
    background-color: #f1f1f3;
    padding: 3px 6px;
    color: #57575b;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.025em;
    line-height: 1.25;
  }
  .inspector-system-health-event-link > small {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 5px 0 0;
    color: #68686e;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 10px;
    font-weight: 500;
    line-height: 1.25;
  }
  .inspector-system-health-event-meta strong {
    color: #6430ab;
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
  }
  .inspector-system-health-signal[data-tone="error"]
    .inspector-system-health-event-type {
    background-color: #fff0f1;
    color: #b32d3b;
  }
  .inspector-system-health-signal[data-tone="success"]
    .inspector-system-health-event-type {
    background-color: #e3f5ee;
    color: #087653;
  }
  .inspector-system-health-signal[data-tone="active"]
    .inspector-system-health-event-type {
    background-color: #fff5df;
    color: #8a5900;
  }
  .inspector-system-health-event-link:hover
    .inspector-system-health-event-meta
    strong {
    text-decoration-color: currentColor;
  }
  .inspector-system-health-event-link:focus-visible {
    border-radius: 3px;
    outline: 2px solid #6430ab;
    outline-offset: 3px;
  }
  .inspector-intelligence-hud {
    overflow: hidden;
    border: 1px solid #c8c6e6;
    border-radius: 5px;
    background-color: #f7f4fe;
  }
  .inspector-intelligence-hud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 18px;
  }
  .inspector-intelligence-hud[data-state="disconnected"] {
    border-color: #bba5df;
  }
  .inspector-intelligence-hud[data-state="disconnected"]
    .inspector-intelligence-hud-header {
    min-height: 132px;
    align-items: center;
    padding: 22px;
  }
  .inspector-intelligence-hud[data-state="disconnected"]
    .inspector-intelligence-hud-header-actions {
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  .inspector-intelligence-hud-heading {
    min-width: 0;
  }
  .inspector-intelligence-hud-header-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: 8px;
  }
  .inspector-intelligence-hud-heading .inspector-home-section-title {
    margin: 0;
    font-size: 18px;
  }
  .inspector-intelligence-hud-description {
    max-width: 64ch;
    margin: 10px 0 0;
    color: #4f4f55;
    font-size: 12px;
    line-height: 1.55;
  }
  .inspector-intelligence-hud-action {
    display: inline-flex;
    min-height: 34px;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid #6430ab;
    border-radius: 4px;
    background-color: #6430ab;
    padding: 8px 11px;
    color: #ffffff;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
  }
  .inspector-intelligence-hud-action:hover {
    border-color: #4e238c;
    background-color: #4e238c;
  }
  .inspector-intelligence-hud-action svg {
    width: 13px;
    height: 13px;
  }
  .inspector-intelligence-hud-connect-action {
    min-height: 38px;
    padding: 10px 14px;
    font-size: 12px;
  }
  .inspector-intelligence-hud-details {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 1px;
    border-top: 1px solid #d5d3e4;
    background-color: #d5d3e4;
  }
  .inspector-intelligence-hud-details > section {
    min-width: 0;
    background-color: #ffffff;
    padding: 15px 18px 17px;
  }
  .inspector-intelligence-hud-detail-label {
    display: block;
    color: #68686e;
    font-size: 11px;
    font-weight: 600;
  }
  .inspector-intelligence-hud-detail-value {
    display: block;
    min-width: 0;
    margin: 5px 0 0;
    overflow: hidden;
    color: #010507;
    font-size: 14px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-intelligence-hud-detail-subvalue {
    display: block;
    margin-top: 3px;
    color: #68686e;
    font-size: 10px;
    font-weight: 500;
    text-transform: capitalize;
  }
  .inspector-intelligence-hud-plan {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(120px, 1fr);
    align-items: start;
    gap: 24px;
  }
  .inspector-intelligence-hud-usage {
    min-width: 0;
  }
  .inspector-intelligence-hud-plan-action {
    min-height: auto;
    margin-top: 9px;
    gap: 4px;
    border: 0;
    border-radius: 0;
    background-color: transparent;
    padding: 0;
    color: #6430ab;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .inspector-intelligence-hud-plan-action:hover {
    border-color: transparent;
    background-color: transparent;
    color: #4e238c;
    text-decoration-color: currentColor;
  }
  .inspector-intelligence-hud-plan-action svg {
    width: 11px;
    height: 11px;
  }
  .inspector-home-usage-bar {
    display: block;
    width: min(160px, 100%);
    height: 5px;
    margin-top: 8px;
    overflow: hidden;
    border-radius: 999px;
    background-color: #dbdbe5;
  }
  .inspector-home-usage-bar > span {
    display: block;
    height: 100%;
    background-color: #bec2ff;
  }
  .inspector-home-feature-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
    align-items: start;
    gap: 12px;
  }
  .inspector-home-feature-group {
    overflow: visible;
    border: 1px solid #d5d3e4;
    border-radius: 5px;
    background-color: #ffffff;
  }
  .inspector-home-feature-group-header {
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-radius: 4px 4px 0 0;
    border-bottom: 1px solid #e4e4ec;
    background-color: #f7f7f9;
    padding: 9px 12px;
    color: #57575b;
  }
  .inspector-home-feature-group-header strong {
    font-size: 12px;
    font-weight: 700;
  }
  .inspector-home-feature-group-header > span {
    display: inline-flex;
    min-width: 22px;
    min-height: 20px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background-color: #ffffff;
    padding: 2px 6px;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10px;
    font-weight: 700;
  }
  .inspector-home-feature-group[data-feature-state-group="active"]
    .inspector-home-feature-group-header {
    border-color: #b9e3d6;
    background-color: #e5f7f1;
    color: #087653;
  }
  .inspector-home-feature-list {
    display: flex;
    flex-direction: column;
    margin: 0;
    background-color: #ffffff;
  }
  .inspector-home-feature {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    container-type: inline-size;
    min-width: 0;
    min-height: 52px;
    align-items: center;
    gap: 8px;
    background-color: #ffffff;
    padding: 9px 12px;
    color: #010507;
    font-size: 12px;
    font-weight: 600;
  }
  .inspector-home-feature + .inspector-home-feature {
    border-top: 1px solid #ececf1;
  }
  .inspector-home-feature:last-child {
    border-radius: 0 0 4px 4px;
  }
  .inspector-home-feature-group-empty {
    margin: 0;
    padding: 15px 12px;
    color: #68686e;
    font-size: 11px;
  }
  .inspector-home-feature:hover {
    background-color: #f7f7f9;
  }
  .inspector-home-feature-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .inspector-home-feature-label > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-home-feature-label-icon {
    display: inline-flex !important;
    flex: none;
    overflow: visible !important;
  }
  .inspector-home-feature-label-icon svg {
    width: 12px;
    height: 12px;
  }
  .inspector-home-feature-label:hover {
    color: #3f176f;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .inspector-home-feature-label:focus-visible {
    border-radius: 3px;
    outline: 2px solid #6430ab;
    outline-offset: 2px;
  }
  .inspector-home-feature-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }
  .inspector-home-feature-status {
    display: inline-flex;
    width: 18px;
    height: 28px;
    flex: none;
    align-items: center;
    justify-content: center;
  }
  .inspector-home-feature-status > span {
    width: 8px;
    height: 8px;
    border: 1px solid #9ca0ab;
    border-radius: 999px;
    background-color: #ffffff;
  }
  .inspector-home-feature[data-state="on"]
    .inspector-home-feature-status
    > span {
    border-color: #087653;
    background-color: #087653;
  }
  .inspector-home-feature[data-state="off"] {
    color: #68686e;
  }
  .inspector-home-feature-action {
    display: inline-flex;
    min-width: 28px;
    height: 28px;
    min-height: 28px;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 1px solid #d5d3e4;
    border-radius: 4px;
    background-color: #ffffff;
    padding: 0 8px;
    color: #4f4f55;
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }
  .inspector-home-feature-action svg {
    width: 14px;
    height: 14px;
  }
  .inspector-home-feature-action-icon {
    display: inline-flex !important;
    flex: none;
    overflow: visible !important;
  }
  .inspector-home-feature-action-label {
    line-height: 1;
  }
  .inspector-home-feature-action.inspector-system-health-url::after {
    content: none;
    right: auto;
    left: 50%;
    transform: translate(-50%, 3px);
  }
  .inspector-home-feature-action.inspector-system-health-url:hover::after,
  .inspector-home-feature-action.inspector-system-health-url:focus-visible::after {
    transform: translate(-50%, 0);
  }
  .inspector-home-feature-action:hover {
    border-color: #bba5df;
    background-color: #f7f4fe;
    color: #3f176f;
  }
  .inspector-home-feature-action:focus-visible {
    outline: 2px solid #6430ab;
    outline-offset: 2px;
  }
  .inspector-home-feature-action[data-copy-state="copied"] {
    border-color: #b9e3d6;
    background-color: #e5f7f1;
    color: #087653;
  }
  .inspector-home-feature-action[data-copy-state="error"] {
    border-color: #e7a7ac;
    background-color: #fff0f1;
    color: #b32d3b;
  }
  @container (max-width: 286px) {
    .inspector-home-feature-action {
      width: 28px;
      padding: 0;
    }
    .inspector-home-feature-action-label {
      display: none !important;
    }
    .inspector-home-feature-action.inspector-system-health-url::after {
      content: attr(data-full-value);
    }
  }
  .inspector-home-features-empty {
    margin: 14px 0 0;
    border-top: 1px solid #deddea;
    border-bottom: 1px solid #deddea;
    padding: 16px 0;
    color: #57575b;
    font-size: 12px;
  }
  .inspector-home-news {
    display: grid;
    gap: 12px;
  }
  @media (max-width: 720px) {
    .inspector-home {
      padding: 24px 22px 34px;
    }
    .inspector-intelligence-hud-header {
      flex-wrap: wrap;
    }
    .inspector-intelligence-hud-details {
      grid-template-columns: 1fr;
    }
    .inspector-intelligence-hud-plan {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .inspector-system-health {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 480px) {
    .inspector-home-feature {
      grid-template-columns: 18px minmax(0, 1fr);
      gap: 8px;
    }
    .inspector-home-feature-actions {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
    .inspector-system-health-section .inspector-system-health-header {
      align-items: flex-start;
    }
    .inspector-intelligence-hud-header {
      flex-direction: column;
      align-items: stretch;
    }
    .inspector-intelligence-hud-header-actions {
      justify-content: space-between;
    }
    .inspector-intelligence-hud-header-actions .inspector-intelligence-hud-action,
    .inspector-intelligence-hud-plan {
      width: 100%;
    }
    .inspector-intelligence-hud-plan {
      grid-template-columns: 1fr;
      align-items: stretch;
    }
    .inspector-intelligence-hud-plan-action {
      justify-self: start;
    }
  }
  [data-inspector-home-intelligence-action]:focus-visible {
    outline: 2px solid #6430ab !important;
    outline-offset: 2px;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home {
    background-color: #111319;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-card,
  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-hud,
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature-list {
    border-color: #3a3d49;
    background: #191c24;
    color: #f3f4f8;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud[data-state="disconnected"] {
    border-color: #666a9e;
    background-color: #1d1e2b;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud[data-state="disconnected"]
    .inspector-intelligence-hud-description {
    color: #c5c7d0;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-system-health,
  .inspector-window[data-color-scheme="dark"] .inspector-system-health-section {
    border-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-system-health-section {
    background-color: #191c24;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-section
    .inspector-system-health-header {
    background-color: #191c24;
    border-bottom-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-system-health {
    background-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-system-health-signal {
    background-color: #191c24;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-event-link
    > small {
    color: #caccff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-header
    > span[data-tone="success"] {
    color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-state[data-tone="success"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-state[data-tone="success"] {
    border-color: #347d69;
    background-color: #173b32;
    color: #8ce1c5 !important;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-state[data-tone="checking"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-state[data-tone="checking"] {
    border-color: #866932;
    background-color: #342916;
    color: #f2cf8f !important;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-state[data-tone="off\\6cine"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-state[data-tone="error"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-state[data-tone="off\\6cine"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-state[data-tone="error"] {
    border-color: #87424a;
    background-color: #3b1c22;
    color: #ff9aa0 !important;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-state[data-tone="unavailable"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-state[data-tone="unavailable"] {
    border-color: #464957;
    background-color: #242731;
    color: #aeb1bd !important;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-header
    > span[data-tone="checking"] {
    color: #f2cf8f;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-header
    > span[data-tone="off\\6cine"],
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-header
    > span[data-tone="error"] {
    color: #ff9aa0;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-title,
  .inspector-window[data-color-scheme="dark"] .inspector-home-section-title,
  .inspector-window[data-color-scheme="dark"] .inspector-home-card-title,
  .inspector-window[data-color-scheme="dark"] .inspector-system-health-signal dd,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details
    .inspector-intelligence-hud-detail-value,
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature {
    color: #f3f4f8;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-eyebrow,
  .inspector-window[data-color-scheme="dark"] .inspector-home-card-label,
  .inspector-window[data-color-scheme="dark"] .inspector-home-meta,
  .inspector-window[data-color-scheme="dark"] .inspector-home-body,
  .inspector-window[data-color-scheme="dark"] .inspector-home-card-copy,
  .inspector-window[data-color-scheme="dark"] .inspector-system-health-signal dt,
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal
    small,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-heading
    p,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details
    .inspector-intelligence-hud-detail-label,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details
    .inspector-intelligence-hud-detail-subvalue,
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-section-header
    > span {
    color: #aeb1bd;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details {
    border-color: #3a3d49;
    background-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details
    > section {
    background-color: #15171e;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-plan-action {
    color: #caccff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-plan-action:hover {
    border-color: transparent;
    background-color: transparent;
    color: #ffffff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal
    + .inspector-system-health-signal,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud-details
    > section
    + section,
  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-hud-details,
  .inspector-window[data-color-scheme="dark"] .inspector-home-features-empty {
    border-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal[data-tone="success"]
    dd {
    color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal[data-tone="active"]
    dd {
    color: #f2cf8f;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal[data-tone="error"]
    .inspector-system-health-event-type {
    background-color: #3b1c22;
    color: #ff9aa0;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal[data-tone="success"]
    .inspector-system-health-event-type {
    background-color: #173b32;
    color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-system-health-signal[data-tone="active"]
    .inspector-system-health-event-type {
    background-color: #342916;
    color: #f2cf8f;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature-group {
    border-color: #3a3d49;
    background-color: #191c24;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-group-header {
    border-color: #3a3d49;
    background-color: #20232d;
    color: #c9ccd6;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-group-header
    > span {
    background-color: #191c24;
    color: #c9ccd6;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-group[data-feature-state-group="active"]
    .inspector-home-feature-group-header {
    border-color: #347d69;
    background-color: #173b32;
    color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature {
    background-color: #191c24;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature:hover {
    background-color: #20232d;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature
    + .inspector-home-feature {
    border-color: #2f323d;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-group-empty {
    color: #9da1af;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature[data-state="off"] {
    color: #aeb1bd;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-status
    > span {
    border-color: #6f7484;
    background-color: #191c24;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature[data-state="on"]
    .inspector-home-feature-status
    > span {
    border-color: #8ce1c5;
    background-color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-action {
    border-color: #464957;
    background-color: #20232d;
    color: #d4d7e0;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-label:hover {
    color: #d8d9ff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-action:hover {
    border-color: #777aae;
    background-color: #292b43;
    color: #ffffff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-action[data-copy-state="copied"] {
    border-color: #347d69;
    background-color: #173b32;
    color: #8ce1c5;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-home-feature-action[data-copy-state="error"] {
    border-color: #87424a;
    background-color: #3b1c22;
    color: #ff9aa0;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-usage-bar {
    background-color: #3a3d49;
  }
`;
