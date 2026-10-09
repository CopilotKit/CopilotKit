import { css } from "lit";

export const homeViewDarkStyles = css`
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
  .inspector-window[data-color-scheme="dark"] .inspector-home-feature-action {
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
