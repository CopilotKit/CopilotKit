import { css } from "lit";

export const homeIntelligenceDarkStyles = css`
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud[data-mode="install"]
    .inspector-intelligence-hud-header {
    border-bottom-color: #3a3d49;
    background: linear-gradient(100deg, #1d1e2b 0%, #221f31 54%, #1a2523 100%);
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-hud[data-mode="install"]
    .inspector-intelligence-hud-heading
    .inspector-home-section-title {
    color: #f3f4f8;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install-hint {
    color: #aeb1bd;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install-hint[data-tone="success"] {
    color: #d5cbff;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install-hint[data-tone="error"] {
    color: #ffb3a1;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install[data-copy-state="copied"]
    .inspector-intelligence-install-copy {
    border-color: #666a9e;
    background-color: transparent;
    color: #d5cbff;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install-secondary {
    color: #caccff;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-install-fallback {
    border-bottom-color: #3a3d49;
    background-color: #15171e;
    color: #c5c7d0;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-story {
    background-color: #15171e;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-beat-label,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-step
    > small,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread
    > small,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-file
    > header
    em {
    color: #8f93a1;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-copy-slide
    > strong,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread
    > strong,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-file
    > header
    strong,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-step
    > strong {
    color: #f3f4f8;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-copy-slide
    > span,
  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-signal,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-code
    > span {
    color: #c5c7d0;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-thread,
  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-signal,
  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-chain-step {
    border-color: #33364a;
    background-color: #1c1f2b;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-thread > i {
    background-color: #666a9e;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread[data-failed="true"] {
    border-color: #5a3129;
    background-color: #2a1a16;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread[data-failed="true"]
    > i {
    background-color: #f97316;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread[data-failed="true"]
    > strong,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-thread[data-failed="true"]
    > small {
    color: #ffb3a1;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-rule,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-proof {
    border-color: #2f5748;
    background-color: #16241f;
    color: #8fd9b8;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-rule > i,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-proof
    svg {
    color: #5be4bb;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-beat-flow,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-arrow {
    color: #666a9e;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-skill-file {
    border-color: #3a3d49;
    background-color: #191c24;
    box-shadow: none;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-file
    > header {
    border-bottom-color: #3a3d49;
    background-color: #1c1f2b;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-file
    > header
    svg,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-code
    > span
    > b,
  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-chain-step
    > i {
    color: #caccff;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-skill-code
    > span::before {
    color: #6d7180;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-story-rail {
    border-top-color: #3a3d49;
  }

  .inspector-window[data-color-scheme="dark"] .inspector-intelligence-story-tab {
    color: #8f93a1;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-story-tab:hover {
    color: #f3f4f8;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-story-tab[data-active="true"] {
    color: #d5cbff;
  }

  .inspector-window[data-color-scheme="dark"]
    .inspector-intelligence-story-tab::after {
    background-color: #a78bfa;
  }
`;
