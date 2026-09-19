import { css } from "lit";

export const homeIntelligenceBaseStyles = css`
  .inspector-intelligence-hud[data-mode="install"]
    .inspector-intelligence-hud-header {
    min-height: 76px;
    align-items: center;
    border-bottom: 1px solid #d5d3e4;
    background: linear-gradient(100deg, #fbfaff 0%, #f2eeff 52%, #edfaf5 100%);
    padding: 18px;
  }

  .inspector-intelligence-hud[data-mode="install"]
    .inspector-intelligence-hud-heading
    .inspector-home-section-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #010507;
    font-size: 18px;
    letter-spacing: -0.025em;
  }

  .inspector-intelligence-mark {
    display: block;
    width: 17px;
    height: 17px;
    flex: none;
  }

  .inspector-intelligence-hud[data-mode="install"]
    .inspector-intelligence-hud-header-actions {
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .inspector-intelligence-sr-summary {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    margin: -1px;
    padding: 0;
    border: 0;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .inspector-intelligence-copy {
    display: grid;
    padding: 16px 18px 0;
  }

  .inspector-intelligence-copy-slide {
    display: flex;
    flex-direction: column;
    gap: 4px;
    grid-area: 1 / 1;
    opacity: 0;
    transition:
      opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .inspector-intelligence-copy-slide[data-position="after"] {
    transform: translateX(14px);
  }

  .inspector-intelligence-copy-slide[data-position="before"] {
    transform: translateX(-14px);
  }

  .inspector-intelligence-copy-slide[data-position="active"] {
    opacity: 1;
    transform: none;
  }

  .inspector-intelligence-copy-slide > strong {
    max-width: 52ch;
    color: #2b2b31;
    font-size: 12.5px;
    font-weight: 650;
    line-height: 1.4;
    text-wrap: balance;
  }

  .inspector-intelligence-copy-slide > span {
    max-width: 64ch;
    color: #4f4f55;
    font-size: 11px;
    line-height: 1.55;
  }

  .inspector-intelligence-install {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
  }

  .inspector-intelligence-install-copy {
    min-height: 34px;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .inspector-intelligence-install-copy svg {
    width: 13px;
    height: 13px;
  }

  .inspector-intelligence-install[data-copy-state="copied"]
    .inspector-intelligence-install-copy {
    border-color: #bba5df;
    background-color: #ffffff;
    color: #4e238c;
  }

  .inspector-intelligence-install-secondary {
    display: inline-flex;
    min-height: 24px;
    align-items: center;
    gap: 5px;
    color: #6430ab;
    font-size: 11px;
    font-weight: 600;
    text-decoration: none;
  }

  .inspector-intelligence-install-secondary:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .inspector-intelligence-install-secondary svg {
    width: 12px;
    height: 12px;
  }

  .inspector-intelligence-install-hint {
    margin: 0;
    color: #68686e;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }

  .inspector-intelligence-install-hint[data-tone="success"] {
    color: #4e238c;
    font-weight: 600;
  }

  .inspector-intelligence-install-hint[data-tone="error"] {
    color: #a3341f;
    font-weight: 600;
  }

  .inspector-intelligence-install-fallback {
    display: block;
    max-height: 96px;
    overflow: auto;
    border-bottom: 1px solid #d5d3e4;
    background-color: #ffffff;
    padding: 10px 18px;
    color: #4f4f55;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10.5px;
    line-height: 1.65;
    user-select: all;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .inspector-intelligence-story {
    container-name: cpk-intel-story;
    container-type: inline-size;
    background-color: #ffffff;
  }

  .inspector-intelligence-story-stage {
    display: grid;
    padding: 16px 18px;
  }

  .inspector-intelligence-beat {
    display: flex;
    visibility: hidden;
    align-items: center;
    grid-area: 1 / 1;
    opacity: 0;
    transition:
      opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 380ms cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0s linear 380ms;
  }

  .inspector-intelligence-beat[data-position="after"] {
    transform: translateX(14px);
  }

  .inspector-intelligence-beat[data-position="before"] {
    transform: translateX(-14px);
  }

  .inspector-intelligence-beat[data-position="active"] {
    visibility: visible;
    opacity: 1;
    transform: none;
    transition:
      opacity 320ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 380ms cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0s;
  }

  .inspector-intelligence-beat[data-beat-id="threads"] {
    flex-direction: column;
    justify-content: center;
    gap: 6px;
  }

  .inspector-intelligence-threads {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 6px;
  }

  .inspector-intelligence-thread {
    display: flex;
    align-items: center;
    gap: 9px;
    border: 1px solid #e6e3f2;
    border-radius: 4px;
    background-color: #faf9fe;
    padding: 8px 10px;
    opacity: 0;
    transform: translateY(3px);
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }

  .inspector-intelligence-thread > i {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background-color: #9b8cc4;
  }

  .inspector-intelligence-thread > strong {
    overflow: hidden;
    color: #2b2b31;
    font-size: 11px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inspector-intelligence-thread > small {
    margin-left: auto;
    flex: none;
    color: #68686e;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 9.5px;
  }

  .inspector-intelligence-thread[data-failed="true"] {
    border-color: #f0d5cf;
    background-color: #fdf6f4;
  }

  .inspector-intelligence-thread[data-failed="true"] > i {
    background-color: #c2410c;
  }

  .inspector-intelligence-thread[data-failed="true"] > strong,
  .inspector-intelligence-thread[data-failed="true"] > small {
    color: #8f2f1c;
    font-weight: 650;
  }

  .inspector-intelligence-story[data-beat="threads"]
    .inspector-intelligence-thread {
    opacity: 1;
    transform: none;
    transition-delay: calc(var(--thread-index) * 80ms + 90ms);
  }

  .inspector-intelligence-beat[data-beat-id="learning"] {
    display: grid;
    align-items: center;
    gap: 12px;
    grid-template-columns: minmax(0, 1.15fr) auto minmax(0, 0.85fr);
  }

  .inspector-intelligence-beat-col {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }

  .inspector-intelligence-beat-label {
    color: #68686e;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .inspector-intelligence-signal,
  .inspector-intelligence-rule {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    border: 1px solid #e6e3f2;
    border-radius: 4px;
    background-color: #faf9fe;
    padding: 6px 8px;
    color: #4f4f55;
    font-size: 10.5px;
    line-height: 1.4;
    opacity: 0;
    transform: translateY(3px);
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }

  .inspector-intelligence-signal {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inspector-intelligence-rule {
    border-color: #cfe9dd;
    background-color: #f4fbf8;
    color: #21543f;
    font-weight: 600;
  }

  .inspector-intelligence-rule > i {
    display: inline-flex;
    flex: none;
    align-items: center;
    color: #1f8a5f;
  }

  .inspector-intelligence-rule > i svg {
    width: 11px;
    height: 11px;
    stroke-width: 2.4;
  }

  .inspector-intelligence-story[data-beat="learning"]
    .inspector-intelligence-signal,
  .inspector-intelligence-story[data-beat="learning"]
    .inspector-intelligence-rule {
    opacity: 1;
    transform: none;
  }

  .inspector-intelligence-story[data-beat="learning"]
    .inspector-intelligence-signal {
    transition-delay: calc(var(--signal-index) * 80ms + 100ms);
  }

  .inspector-intelligence-story[data-beat="learning"]
    .inspector-intelligence-rule {
    transition-delay: calc(var(--rule-index) * 80ms + 420ms);
  }

  .inspector-intelligence-beat-flow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #9b8cc4;
  }

  .inspector-intelligence-beat-flow svg {
    width: 15px;
    height: 15px;
  }

  .inspector-intelligence-beat[data-beat-id="skill"] {
    justify-content: center;
  }

  .inspector-intelligence-skill-file {
    width: min(100%, 30rem);
    overflow: hidden;
    border: 1px solid #d5d3e4;
    border-radius: 5px;
    background-color: #ffffff;
    box-shadow: 0 1px 2px rgb(16 12 40 / 6%);
  }

  .inspector-intelligence-skill-file > header {
    display: flex;
    align-items: center;
    gap: 7px;
    border-bottom: 1px solid #ebe9f4;
    background-color: #faf9fe;
    padding: 7px 10px;
  }

  .inspector-intelligence-skill-file > header svg {
    width: 12px;
    height: 12px;
    color: #6430ab;
  }

  .inspector-intelligence-skill-file > header strong {
    color: #2b2b31;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
  }

  .inspector-intelligence-skill-file > header em {
    margin-left: auto;
    color: #68686e;
    font-size: 9px;
    font-style: normal;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .inspector-intelligence-skill-code {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10.5px;
    line-height: 1.75;
  }

  .inspector-intelligence-skill-code > span {
    display: flex;
    gap: 10px;
    padding: 0 12px;
    color: #4f4f55;
  }

  .inspector-intelligence-skill-code > span::before {
    min-width: 8px;
    color: #a9a7bb;
    content: attr(data-line);
    text-align: right;
  }

  .inspector-intelligence-skill-code > span > b {
    color: #6430ab;
    font-weight: 600;
  }

  .inspector-intelligence-skill-code > span[style*="--rule-index"] {
    opacity: 0;
    transform: translateY(2px);
    transition:
      opacity 260ms ease,
      transform 260ms ease;
  }

  .inspector-intelligence-story[data-beat="skill"]
    .inspector-intelligence-skill-code
    > span[style*="--rule-index"] {
    opacity: 1;
    transform: none;
    transition-delay: calc(var(--rule-index) * 110ms + 260ms);
  }

  .inspector-intelligence-beat[data-beat-id="intelligence"] {
    flex-direction: column;
    justify-content: center;
    gap: 12px;
  }

  .inspector-intelligence-chain {
    display: flex;
    width: 100%;
    align-items: stretch;
    justify-content: center;
    gap: 6px;
  }

  .inspector-intelligence-chain-step {
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    border: 1px solid #e6e3f2;
    border-radius: 5px;
    background-color: #faf9fe;
    padding: 9px 10px;
    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity 280ms ease,
      transform 280ms ease;
  }

  .inspector-intelligence-chain-step > i {
    display: inline-flex;
    color: #6430ab;
  }

  .inspector-intelligence-chain-step > i svg {
    width: 14px;
    height: 14px;
  }

  .inspector-intelligence-chain-step > strong {
    color: #2b2b31;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.25;
  }

  .inspector-intelligence-chain-step > small {
    color: #68686e;
    font-size: 9.5px;
    line-height: 1.3;
  }

  .inspector-intelligence-chain-arrow {
    display: inline-flex;
    flex: none;
    align-items: center;
    color: #bba5df;
    opacity: 0;
    transition: opacity 280ms ease;
  }

  .inspector-intelligence-chain-arrow svg {
    width: 13px;
    height: 13px;
  }

  .inspector-intelligence-story[data-beat="intelligence"]
    .inspector-intelligence-chain-step,
  .inspector-intelligence-story[data-beat="intelligence"]
    .inspector-intelligence-chain-arrow {
    opacity: 1;
    transform: none;
    transition-delay: calc(var(--step-index) * 90ms + 80ms);
  }

  .inspector-intelligence-chain-proof {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: center;
    border: 1px solid #cfe9dd;
    border-radius: 999px;
    background-color: #f4fbf8;
    padding: 5px 11px;
    color: #21543f;
    font-size: 10.5px;
    font-weight: 600;
    opacity: 0;
    transform: translateY(3px);
    transition:
      opacity 300ms ease,
      transform 300ms ease;
  }

  .inspector-intelligence-chain-proof svg {
    width: 12px;
    height: 12px;
    color: #1f8a5f;
  }

  .inspector-intelligence-chain-proof code {
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10px;
    font-weight: 600;
  }

  .inspector-intelligence-story[data-beat="intelligence"]
    .inspector-intelligence-chain-proof {
    opacity: 1;
    transform: none;
    transition-delay: 460ms;
  }

  .inspector-intelligence-story-rail {
    display: flex;
    align-items: center;
    gap: 2px;
    border-top: 1px solid #ebe9f4;
    padding: 8px 18px 9px;
  }

  .inspector-intelligence-story-tab {
    position: relative;
    min-width: 24px;
    min-height: 24px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    padding: 3px 7px 5px;
    color: #68686e;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: color 160ms ease;
  }

  .inspector-intelligence-story-tab::after {
    position: absolute;
    right: 7px;
    bottom: 1px;
    left: 7px;
    height: 1.5px;
    border-radius: 2px;
    background-color: #6430ab;
    content: "";
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .inspector-intelligence-story-tab:hover {
    color: #2b2b31;
  }

  .inspector-intelligence-story-tab[data-active="true"] {
    color: #4e238c;
  }

  .inspector-intelligence-story-tab[data-active="true"]::after {
    transform: scaleX(1);
  }

  .inspector-intelligence-install-copy:focus-visible,
  .inspector-intelligence-install-secondary:focus-visible,
  .inspector-intelligence-story-tab:focus-visible {
    outline: 2px solid #6430ab;
    outline-offset: 2px;
  }

  @container cpk-intel-story (max-width: 30rem) {
    .inspector-intelligence-chain-step > small {
      display: none;
    }

    .inspector-intelligence-story-rail {
      flex-wrap: wrap;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .inspector-intelligence-copy-slide,
    .inspector-intelligence-thread,
    .inspector-intelligence-beat,
    .inspector-intelligence-signal,
    .inspector-intelligence-rule,
    .inspector-intelligence-chain-step,
    .inspector-intelligence-chain-arrow,
    .inspector-intelligence-chain-proof,
    .inspector-intelligence-skill-code > span[style*="--rule-index"],
    .inspector-intelligence-story-tab::after {
      transition-duration: 0s;
      transition-delay: 0s;
    }
  }
`;
