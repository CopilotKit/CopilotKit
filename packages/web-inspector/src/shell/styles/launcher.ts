import { css, unsafeCSS } from "lit";

import { LAUNCHER_SIGNAL_COLORS } from "./tokens.js";

export const shellLauncherStyles = css`
  /* ── Launcher HUD: hover menu, quieter than the error island ── */
  .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
    pointer-events: auto;
    opacity: 1;
    transform: none;
    visibility: visible;
  }

  .cpk-launcher-hud {
    --hud-fill: var(--cpk-inspector-surface-dark);
    --hud-line: rgb(190 194 255 / 0.38);
    --hud-accent: #b8adf5;
    --hud-accent-soft: rgb(184 173 245 / 0.13);
    --hud-hover-fill: #252231;
    --hud-blur: blur(12px) saturate(1.2);
    --hud-card-gap: 8px;
    --hud-dismiss-day-height: 32px;
    position: absolute;
    z-index: 4;
    width: 258px;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 160ms ease,
      transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cpk-launcher-hud[data-cpk-hud-vertical="top"] {
    top: 0;
    bottom: auto;
  }

  .cpk-launcher-hud[data-cpk-hud-vertical="bottom"] {
    top: auto;
    bottom: 0;
  }

  .cpk-launcher-hud[data-cpk-hud-side="left"] {
    right: 100%;
    left: auto;
    padding-right: 14px;
    transform: translateX(8px);
  }

  .cpk-launcher-hud[data-cpk-hud-side="right"] {
    left: 100%;
    right: auto;
    padding-left: 14px;
    transform: translateX(-8px);
  }

  .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
    transform: none;
  }

  .cpk-launcher-hud__card {
    position: relative;
    display: grid;
    width: 244px;
    gap: var(--hud-card-gap);
    color: #fff;
  }

  .cpk-launcher-hud[data-color-scheme="light"] {
    --hud-fill: #fff;
    --hud-line: #ddd6f4;
    --hud-accent: #6757b0;
    --hud-accent-soft: #f1edff;
    --hud-hover-fill: #f1edff;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__card {
    color: #010507;
  }

  .cpk-launcher-hud__arrow {
    position: absolute;
    top: calc(var(--cpk-launcher-size) / 2);
    z-index: 2;
    width: 10px;
    height: 10px;
    border: 0;
    background: var(--hud-fill);
    transform: rotate(45deg);
    transition: background 120ms ease;
  }

  .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__arrow {
    right: 9px;
    border-top: 1px solid var(--hud-line);
    border-right: 1px solid var(--hud-line);
  }

  .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__arrow {
    left: 9px;
    border-bottom: 1px solid var(--hud-line);
    border-left: 1px solid var(--hud-line);
  }

  .cpk-launcher-hud[data-cpk-hud-vertical="top"] .cpk-launcher-hud__arrow {
    top: calc(var(--cpk-launcher-size) / 2 - 5px);
  }

  .cpk-launcher-hud[data-cpk-hud-vertical="bottom"] .cpk-launcher-hud__arrow {
    top: auto;
    bottom: calc(var(--cpk-launcher-size) / 2 - 5px);
  }

  /* Keep a bottom HUD's pointer attached to the full-width feature panel
         instead of the narrower dismissal action beneath it. */
  .cpk-launcher-hud[data-cpk-hud-vertical="bottom"]:has(
      .cpk-launcher-hud__dismiss-day
    )
    .cpk-launcher-hud__arrow {
    bottom: calc(var(--hud-dismiss-day-height) + var(--hud-card-gap) + 2px);
  }

  .cpk-launcher-hud__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cpk-launcher-hud__masthead {
    position: relative;
    z-index: 1;
    margin-top: 6px;
    padding: 0;
    border: 1px solid var(--hud-line);
    border-radius: var(--cpk-inspector-shell-radius);
    background: var(--hud-fill);
    backdrop-filter: var(--hud-blur);
    -webkit-backdrop-filter: var(--hud-blur);
    box-shadow: 0 10px 28px rgb(46 37 91 / 0.16);
    transition: background 120ms ease;
  }

  .cpk-launcher-hud__news-wrap {
    position: relative;
    margin: 0;
  }

  .cpk-launcher-hud__news {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    padding: 18px 12px 11px;
    border: 0;
    border-radius: calc(var(--cpk-inspector-shell-radius) - 1px);
    background: transparent;
    color: #fff;
    font-family: inherit;
    line-height: 1;
    text-align: start;
    cursor: pointer;
  }

  .cpk-launcher-hud__news:hover,
  .cpk-launcher-hud__news:focus-visible {
    background: transparent;
  }

  .cpk-launcher-hud__masthead:has(.cpk-launcher-hud__news:hover),
  .cpk-launcher-hud__masthead:has(.cpk-launcher-hud__news:focus-visible),
  .cpk-launcher-hud:has(.cpk-launcher-hud__news:hover) .cpk-launcher-hud__arrow,
  .cpk-launcher-hud:has(.cpk-launcher-hud__news:focus-visible)
    .cpk-launcher-hud__arrow {
    background: var(--hud-hover-fill);
  }

  .cpk-launcher-hud__news:focus-visible {
    outline: 2px solid #bec2ff;
    outline-offset: 1px;
  }

  .cpk-launcher-hud__news-title {
    display: block;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.32;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .cpk-launcher-hud__news-label {
    position: absolute;
    top: -9px;
    left: 12px;
    display: inline-flex;
    min-height: 20px;
    align-items: center;
    padding: 3px 8px;
    border-radius: 6px;
    background: #7563c7;
    color: #fff;
    box-shadow: 0 3px 8px rgb(46 37 91 / 0.18);
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
  }

  .cpk-launcher-hud__news-dismiss {
    position: absolute;
    top: -1px;
    right: 2px;
    z-index: 2;
    display: inline-flex;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: rgb(255 255 255 / 0.68);
    cursor: pointer;
  }

  .cpk-launcher-hud__news-dismiss:hover,
  .cpk-launcher-hud__news-dismiss:focus-visible {
    background: var(--hud-accent-soft);
    color: #fff;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__news-dismiss {
    color: #6e697c;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__news-dismiss:hover,
  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__news-dismiss:focus-visible {
    color: #27233a;
  }

  .cpk-launcher-hud__news-dismiss:focus-visible {
    outline: 2px solid #bec2ff;
    outline-offset: 1px;
  }

  .cpk-launcher-hud__news-dismiss svg {
    width: 7px;
    height: 7px;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__news {
    color: #17131f;
  }

  .cpk-launcher-hud__dismiss-day {
    position: relative;
    z-index: 1;
    display: flex;
    width: auto;
    min-height: var(--hud-dismiss-day-height);
    align-items: center;
    justify-content: center;
    justify-self: center;
    gap: 6px;
    margin: 0;
    padding: 7px 13px;
    border: 1px solid var(--hud-line);
    border-radius: var(--cpk-inspector-shell-radius);
    background: var(--hud-fill);
    color: #c9cad3;
    box-shadow: 0 8px 20px rgb(17 14 29 / 0.18);
    font-family: inherit;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.2;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background 120ms ease,
      color 120ms ease;
  }

  .cpk-launcher-hud__dismiss-day:hover,
  .cpk-launcher-hud__dismiss-day:focus-visible {
    border-color: var(--hud-accent);
    background: var(--hud-hover-fill);
    color: #f3f4f8;
  }

  .cpk-launcher-hud__dismiss-day:focus-visible {
    outline: 2px solid #bec2ff;
    outline-offset: 1px;
  }

  .cpk-launcher-hud__dismiss-day svg {
    width: 12px;
    height: 12px;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__dismiss-day {
    box-shadow: 0 8px 20px rgb(46 37 91 / 0.12);
    color: #5f6068;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__dismiss-day:hover,
  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__dismiss-day:focus-visible {
    color: #36373d;
  }

  .cpk-launcher-hud__feature-list {
    position: relative;
    z-index: 1;
    padding: 5px;
    border: 1px solid var(--hud-line);
    border-radius: var(--cpk-inspector-shell-radius);
    background: var(--hud-fill);
    backdrop-filter: var(--hud-blur);
    -webkit-backdrop-filter: var(--hud-blur);
    box-shadow: 0 10px 28px rgb(46 37 91 / 0.16);
  }

  .cpk-launcher-hud__row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    min-height: 54px;
    border-radius: 9px;
    cursor: pointer;
  }

  .cpk-launcher-hud__row + .cpk-launcher-hud__row {
    border-top: 1px solid var(--hud-line);
    border-radius: 0 0 9px 9px;
  }

  .cpk-launcher-hud__row:hover,
  .cpk-launcher-hud__row:focus-within {
    background: rgb(255 255 255 / 0.06);
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:hover,
  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__row:focus-within {
    background: #f7f5ff;
  }

  .cpk-launcher-hud__primary {
    position: relative;
    display: flex;
    min-width: 0;
  }

  .cpk-launcher-hud__action {
    display: flex;
    width: 100%;
    gap: 8px;
    min-height: 52px;
    align-items: center;
    padding: 7px 4px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #fff;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }

  .cpk-launcher-hud__label {
    min-width: 0;
  }

  .cpk-launcher-hud__feature-icon {
    display: inline-flex;
    width: 28px;
    height: 32px;
    flex: none;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--hud-accent);
  }

  .cpk-launcher-hud__feature-icon svg {
    width: 17px;
    height: 17px;
    stroke-width: 1.8;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__action {
    color: #010507;
  }

  /* Stretch the row action over the whole tab. The icon controls sit
         above this layer and keep their own focused interactions. */
  .cpk-launcher-hud__action::after {
    content: "";
    position: absolute;
    inset: 0;
  }

  .cpk-launcher-hud__controls {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 0;
    align-items: center;
    padding-right: 5px;
  }

  .cpk-launcher-hud__learn-more {
    display: inline-flex;
    width: 24px;
    height: 44px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: rgb(190 194 255 / 0.72);
    cursor: pointer;
  }

  .cpk-launcher-hud__learn-more:hover,
  .cpk-launcher-hud__learn-more:focus-visible {
    color: #fff;
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__learn-more {
    color: #777080;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__learn-more:hover,
  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__learn-more:focus-visible {
    color: #4b416b;
  }

  .cpk-launcher-hud__learn-more svg {
    width: 16px;
    height: 16px;
    stroke-width: 1.8;
  }

  .cpk-launcher-hud__toggle {
    display: inline-flex;
    width: 38px;
    height: 44px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: rgb(255 255 255 / 0.78);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .cpk-launcher-hud__toggle:disabled {
    cursor: not-allowed;
    opacity: 1;
  }

  .cpk-launcher-hud__toggle-track {
    position: relative;
    display: block;
    width: 34px;
    height: 20px;
    border: 1px solid rgb(190 194 255 / 0.38);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    transition:
      border-color 120ms ease,
      background 120ms ease;
  }

  .cpk-launcher-hud__toggle-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #8c8e99;
    transition:
      background 120ms ease,
      transform 120ms ease;
  }

  .cpk-launcher-hud__toggle[data-enabled="true"]
    .cpk-launcher-hud__toggle-track {
    border-color: var(--hud-accent);
    background: color-mix(in srgb, var(--hud-accent) 76%, transparent);
  }

  .cpk-launcher-hud__toggle[data-enabled="true"]
    .cpk-launcher-hud__toggle-track::after {
    background: #fff;
    transform: translateX(14px);
  }

  .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__toggle-track {
    border-color: #c9c9d2;
    background: #e7e7ec;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__toggle-track::after {
    background: #777780;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__toggle[data-enabled="true"]
    .cpk-launcher-hud__toggle-track {
    border-color: #6757b0;
    background: #7563c7;
  }

  .cpk-launcher-hud[data-color-scheme="light"]
    .cpk-launcher-hud__toggle[data-enabled="true"]
    .cpk-launcher-hud__toggle-track::after {
    background: #fff;
  }

  .cpk-launcher-hud__toggle:focus-visible,
  .cpk-launcher-hud__learn-more:focus-visible,
  .cpk-launcher-hud__action:focus-visible {
    outline: 2px solid #bec2ff;
    outline-offset: 1px;
  }

  .cpk-launcher-hud__tooltip {
    position: absolute;
    top: 50%;
    z-index: 30;
    width: max-content;
    max-width: min(220px, 52vw);
    padding: 7px 9px;
    border: 1px solid #3a3d49;
    border-radius: 4px;
    background: #15171e;
    color: #f3f4f8;
    box-shadow: 0 8px 20px rgb(1 5 7 / 0.18);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.45;
    opacity: 0;
    pointer-events: none;
    transform: translate(3px, -50%);
    white-space: normal;
    transition:
      opacity 120ms ease,
      transform 120ms ease;
  }

  .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:hover)
    .cpk-launcher-hud__tooltip,
  .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:focus-visible)
    .cpk-launcher-hud__tooltip {
    opacity: 1;
    transform: translate(0, -50%);
  }

  .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__tooltip {
    right: calc(100% + 8px);
    left: auto;
  }

  .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__tooltip {
    right: auto;
    left: calc(100% + 8px);
    transform: translate(-3px, -50%);
  }

  .cpk-launcher-hud[data-cpk-hud-side="right"]
    .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:hover)
    .cpk-launcher-hud__tooltip,
  .cpk-launcher-hud[data-cpk-hud-side="right"]
    .cpk-launcher-hud__row:has(.cpk-launcher-hud__learn-more:focus-visible)
    .cpk-launcher-hud__tooltip {
    transform: translate(0, -50%);
  }

  @media (prefers-reduced-motion: reduce) {
    .cpk-launcher-hud,
    .cpk-launcher-hud__tooltip {
      transition: none;
    }
  }

  /*
       * On mount, borrow the hover HUD for one short introduction. The card
       * establishes the destination first; notification, features, and hide
       * action then fall into place from top to bottom. Only opacity and
       * transform move.
       */
  @keyframes cpk-launcher-hud-intro {
    0% {
      opacity: 0;
      transform: translateY(-4px);
    }
    8%,
    88% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateY(3px);
    }
  }

  @keyframes cpk-launcher-hud-waterfall {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .cpk-launcher-hud[data-cpk-hud-intro="true"] {
    animation: cpk-launcher-hud-intro var(--cpk-launcher-hud-intro-duration)
      cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .cpk-launcher-hud[data-cpk-hud-intro="true"]
    :is(
      .cpk-launcher-hud__masthead,
      .cpk-launcher-hud__feature-list,
      .cpk-launcher-hud__row,
      .cpk-launcher-hud__dismiss-day
    ) {
    animation: cpk-launcher-hud-waterfall
      var(--cpk-launcher-hud-waterfall-duration) cubic-bezier(0.16, 1, 0.3, 1)
      both;
    animation-delay: var(--cpk-hud-waterfall-delay);
  }

  @media (prefers-reduced-motion: reduce) {
    .cpk-launcher-hud[data-cpk-hud-intro="true"],
    .cpk-launcher-hud[data-cpk-hud-intro="true"]
      :is(
        .cpk-launcher-hud__masthead,
        .cpk-launcher-hud__feature-list,
        .cpk-launcher-hud__row,
        .cpk-launcher-hud__dismiss-day
      ) {
      animation: none !important;
      opacity: 1;
      transform: none;
    }
  }

  /*
       * Marker on the navigation entry, which is what keeps a signal alive
       * once the panel is open and the launcher is hidden. Static by design:
       * the beat belongs to the launcher, and movement here would compete with
       * the live event stream a developer is actually watching.
       *
       * Tone-selected rather than tone-agnostic, because the marker has to
       * agree with the dot that sent the reader here. Same shape, same
       * placement, one declaration different — as on the launcher, where the
       * treatment is shared and only the injected colour changes.
       */
  .inspector-nav-signal-dot {
    display: inline-block;
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${unsafeCSS(LAUNCHER_SIGNAL_COLORS.news)};
  }
  .inspector-nav-signal-dot[data-cpk-signal-tone="error"] {
    background: ${unsafeCSS(LAUNCHER_SIGNAL_COLORS.error)};
  }
`;
