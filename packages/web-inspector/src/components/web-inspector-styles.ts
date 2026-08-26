import { css, unsafeCSS } from "lit";

import { LAUNCHER_SIGNAL_COLORS } from "../lib/launcher-signals.js";
import tailwindStyles from "../styles/generated.css";

export const LAUNCHER_MIN_SIZE = 51.84;
export const LAUNCHER_MAX_SIZE = 62.208;

export const webInspectorStyles = [
  unsafeCSS(tailwindStyles),
  css`
      :host {
        --cpk-inspector-shell-radius: 5px;
        --cpk-inspector-surface-dark: #111319;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483646;
        display: block;
        will-change: transform;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      }

      .rounded-sm {
        border-radius: 3px;
      }

      .rounded-md {
        border-radius: 7px;
      }

      .rounded-lg {
        border-radius: 10px;
      }

      .rounded-xl {
        border-radius: 14px;
      }

      :host([data-docked="true"]) {
        top: 0;
        left: 0;
        bottom: 0;
        transform: none !important;
        will-change: auto;
      }

      :host([data-transitioning="true"]) {
        transition: transform 300ms ease;
      }

      .console-button-wrapper {
        position: relative;
        display: inline-flex;
        /* The launcher's surface and edge, shared by the button and the pill so
           the two cannot drift apart. A dark grey rather than near-black: the
           launcher sits on a customer's page, and 1,5,7 against white is a
           harder edge than this surface needs. */
        --cpk-launcher-face: rgba(24, 28, 31, 0.95);
        --cpk-launcher-face-solid: rgb(24, 28, 31);
        --cpk-launcher-edge: rgba(190, 194, 255, 0.25);
        /* The launcher's own size, exposed so the signal dot can be placed
           against the OUTER rim with a length rather than a percentage.
           Percentages resolve against the padding box, which the 1px border
           insets, and the dot would land inside the rim.

           Declared on the wrapper rather than on the button so the pill, which
           is the button's sibling, can clear the mark by the same length. */
        --cpk-launcher-size: clamp(
          ${LAUNCHER_MIN_SIZE}px,
          7vw,
          ${LAUNCHER_MAX_SIZE}px
        );
      }

      .console-button {
        width: var(--cpk-launcher-size);
        height: var(--cpk-launcher-size);
        /* Keep the 1px border inside the declared outer size. */
        box-sizing: border-box;
        transition:
          transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
          opacity 160ms ease;
      }

      .console-button[data-dragging="true"] {
        transition: opacity 160ms ease;
      }

      .inspector-window[data-transitioning="true"] {
        transition:
          width 300ms ease,
          height 300ms ease;
      }

      .inspector-window[data-docked="true"] {
        border-radius: 0 !important;
        box-shadow: none !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        height: auto !important;
        max-height: none !important;
      }

      .resize-handle {
        touch-action: none;
        user-select: none;
        z-index: 60;
      }

      .edge-resize-handle {
        position: absolute;
        z-index: 55;
        touch-action: none;
        user-select: none;
        background: transparent;
      }

      .edge-resize-handle-e {
        top: 48px;
        right: 0;
        width: 8px;
        height: calc(100% - 48px);
        cursor: ew-resize;
      }

      .edge-resize-handle-w {
        top: 48px;
        left: 0;
        width: 8px;
        height: calc(100% - 48px);
        cursor: ew-resize;
      }

      .edge-resize-handle-s {
        left: 0;
        bottom: 0;
        width: 100%;
        height: 8px;
        cursor: ns-resize;
      }

      .dock-resize-handle {
        position: absolute;
        top: 0;
        right: 0;
        width: 10px;
        height: 100%;
        cursor: ew-resize;
        touch-action: none;
        z-index: 50;
        background: transparent;
      }

      .tooltip-target {
        position: relative;
      }

      .tooltip-target::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%) translateY(-4px);
        white-space: nowrap;
        background: rgba(1, 5, 7, 0.95);
        color: white;
        padding: 4px 8px;
        border-radius: 7px;
        font-size: 10px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        line-height: 1.2;
        box-shadow: 0 4px 10px rgba(1, 5, 7, 0.18);
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 120ms ease,
          transform 120ms ease;
        z-index: 4000;
      }

      .tooltip-target:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ── Agent tab section cards ─────────────────────────────────────── */
      .cpk-section-card {
        border-radius: 10px;
        background: #ffffff;
        overflow: hidden;
      }

      /* ── Agent icon bubble ───────────────────────────────────────────── */
      .cpk-agent-icon {
        background-color: #f0f0f4 !important;
        color: #57575b !important;
      }

      /* ── Agent stat cards ────────────────────────────────────────────── */
      .cpk-stat-card {
        background-color: #ffffff !important;
        border: 1px solid #dbdbe5 !important;
      }
      button.cpk-stat-card:hover {
        background-color: #f7f7f9 !important;
      }

      /* ── Circle chevron (Frontend Tools + Context) ──────────────────── */
      .cpk-chevron-circle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: #f0f0f4;
        color: #68686e;
        flex-shrink: 0;
        transition: transform 0.2s;
      }
      .cpk-chevron-circle svg {
        width: 14px !important;
        height: 14px !important;
      }
      .cpk-chevron-circle--open {
        transform: rotate(180deg);
      }

      /* ── Inline copy button ─────────────────────────────────────────── */
      .cpk-copy-btn {
        font-size: 10px;
        font-weight: 500;
        color: #57575b;
        background: #ffffff;
        border: 1px solid #dbdbe5;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 5px;
        flex-shrink: 0;
        transition:
          background-color 0.15s,
          border-color 0.15s;
      }
      .cpk-copy-btn:hover {
        background-color: #f0f0f4;
        border-color: #afafb7;
      }

      .cpk-section-header {
        background: #e8edf5;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        padding: 10px 16px;
      }
      .cpk-section-header h4 {
        font-size: 11px;
        font-weight: 600;
        color: #181c1f;
        margin: 0;
      }

      /* Inputs/selects inside the lavender header need an explicit white bg */
      .cpk-section-header input,
      .cpk-section-header select {
        background-color: #ffffff !important;
        box-shadow: none !important;
      }
      .cpk-section-header select {
        padding-right: 24px !important;
      }
      /* Events table column headers */
      table thead th {
        font-weight: 600 !important;
      }

      .announcement-content {
        color: #1f2230;
        font-size: 13px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        line-height: 1.55;
      }

      .announcement-content h1,
      .announcement-content h2,
      .announcement-content h3 {
        color: #010507;
        font-weight: 700;
        line-height: 1.3;
        margin: 0.9rem 0 0.4rem;
      }
      .announcement-content > h1:first-child,
      .announcement-content > h2:first-child,
      .announcement-content > h3:first-child {
        margin-top: 0;
      }

      .announcement-content h1 {
        font-size: 1.15rem;
        letter-spacing: -0.01em;
      }
      .announcement-content h2 {
        font-size: 1rem;
      }
      .announcement-content h3 {
        font-size: 0.9rem;
        text-transform: none;
      }

      .announcement-content p {
        margin: 0.45rem 0;
      }

      .announcement-content strong {
        color: #010507;
        font-weight: 700;
      }

      .announcement-content ul {
        list-style: disc;
        padding-left: 1.25rem;
        margin: 0.45rem 0;
      }

      .announcement-content ol {
        list-style: decimal;
        padding-left: 1.25rem;
        margin: 0.45rem 0;
      }

      .announcement-content li + li {
        margin-top: 0.15rem;
      }

      .announcement-content a {
        color: #5558b2;
        text-decoration: underline;
      }

      .announcement-content :not(pre) > code {
        background: #f3f3f7;
        border: 1px solid #e4e4ec;
        border-radius: 5px;
        padding: 1px 5px;
        font-size: 0.85em;
        color: #4a3a8a;
      }

      .announcement-code {
        position: relative;
        margin: 0.6rem 0;
      }

      .announcement-code pre {
        background: #0f1117;
        color: #e6e8f2;
        border-radius: 10px;
        padding: 10px 12px;
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
      }

      .announcement-code pre code::after {
        content: "";
        display: inline-block;
        width: 80px;
      }

      .announcement-code__copy-shield {
        position: absolute;
        top: 4px;
        right: 4px;
        padding: 4px 4px 4px 24px;
        border-top-right-radius: 10px;
        background: linear-gradient(
          to right,
          rgba(15, 17, 23, 0) 0%,
          rgba(15, 17, 23, 0.95) 40%,
          #0f1117 100%
        );
        pointer-events: none;
      }

      .announcement-code pre code {
        background: transparent;
        border: none;
        padding: 0;
        color: inherit;
        font-size: inherit;
      }

      .announcement-code pre::-webkit-scrollbar {
        height: 6px;
      }
      .announcement-code pre::-webkit-scrollbar-track {
        background: transparent;
      }
      .announcement-code pre::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .announcement-code__copy {
        position: relative;
        pointer-events: auto;
        padding: 3px 8px;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #e6e8f2;
        background: #1f222d;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .announcement-code__copy:hover {
        background: #2a2e3c;
      }
      .announcement-code__copy[data-copied="true"] {
        background: #eee6fe;
        color: #6430ab;
        border-color: transparent;
      }

      /* ── What's new ──────────────────────────────────────────────── */
      .whats-new {
        display: block;
        padding: 16px;
      }

      .whats-new__heading {
        margin: 0 0 10px;
        color: #010507;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: -0.01em;
      }

      .whats-new__status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #57575b;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        font-size: 13px;
      }

      .whats-new__status-icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: #eee6fe;
        color: #5558b2;
      }

      /* ── Brand typography ────────────────────────────────────────── */
      /* Override Tailwind font-mono stack → Spline Sans Mono */
      .font-mono,
      pre,
      code {
        font-family:
          "Spline Sans Mono", ui-monospace, "Cascadia Code", monospace;
      }

      /* ── Floating button ─────────────────────────────────────────── */
      .console-button {
        background-color: var(--cpk-launcher-face) !important;
        border-color: var(--cpk-launcher-edge) !important;
        /* One hairline, not two. The border above is it; a second ring used to
           sit 1px outside as a box-shadow and hardcoded the lilac instead of
           reading the --cpk-launcher-edge token, so it could not follow it.
           What replaces it is a one-pixel light edge along the top, which is
           what keeps the face from reading flat without drawing a frame.

           The border is not decoration: the face is #181C1F, which against a
           dark host page (GitHub dark 1.10:1, Tailwind slate-900 1.04:1) is
           indistinguishable from the page. It is the only thing that gives the
           launcher an outline there, so it stays. */
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.07),
          0 4px 14px rgba(1, 5, 7, 0.28) !important;
        /* Promotes the launcher to its own compositing layer, which the
           backdrop-filter this replaces used to do as a side effect. Without
           a layer the hover scale re-rasterises the mark every frame and it
           visibly jitters; with one, the compositor scales it as a texture. */
        will-change: transform;
      }
      .console-button:hover {
        background-color: var(--cpk-launcher-face-solid) !important;
        border-color: rgba(190, 194, 255, 0.45) !important;
      }
      .console-button:focus-visible {
        outline-color: #bec2ff !important;
      }

      /* ── Launcher signal: water ripple + internal wash + dot ────── */
      /*
       * Two rings leave the rim in sequence, like ripples spreading from a
       * drop's point of impact. They share one keyframe but the second begins
       * 180ms later, so the first is already farther from the source.
       *
       * ONLY opacity and transform animate. This component is permanently
       * mounted on top of a customer's application, so animating anything
       * that forces a repaint every frame is not acceptable.
       */
      .console-button[data-cpk-signal] {
        isolation: isolate;
      }

      /*
       * The mark sits above the ripples. Both ring layers are absolutely
       * positioned, so without a stacking position of its own the mark — an
       * ordinary in-flow child — would paint under them. Keeping the centre
       * readable is the reason the motion begins at the rim.
       */
      .cpk-launcher-mark {
        position: relative;
        z-index: 2;
        width: auto;
        height: calc(var(--cpk-launcher-size) / 1.8);
      }

      .console-button[data-cpk-signal]::before,
      .console-button[data-cpk-signal]::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid
          color-mix(in srgb, var(--cpk-launcher-signal) 68%, transparent);
        box-shadow: 0 0 8px
          color-mix(in srgb, var(--cpk-launcher-signal) 38%, transparent);
        pointer-events: none;
        opacity: 0;
        transform: scale(1);
      }

      .cpk-launcher-signal-wash {
        position: absolute;
        inset: 0;
        z-index: 1;
        overflow: hidden;
        border-radius: 50%;
        pointer-events: none;
        opacity: 0;
        background: radial-gradient(
          circle at 50% 50%,
          transparent 26%,
          color-mix(in srgb, var(--cpk-launcher-signal) 78%, transparent) 63%,
          color-mix(in srgb, var(--cpk-launcher-signal) 30%, transparent) 84%,
          transparent 100%
        );
      }

      @keyframes cpk-launcher-ripple {
        0% {
          opacity: 0.95;
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(1.5);
        }
      }

      @keyframes cpk-launcher-wash {
        0%,
        100% {
          opacity: 0;
        }
        45% {
          opacity: 1;
        }
      }

      /* Both ripples finish inside the existing one-beat pulse window. */
      .console-button[data-cpk-signal-pulsing="true"]::before,
      .console-button[data-cpk-signal-pulsing="true"]::after {
        animation: cpk-launcher-ripple calc(var(--cpk-launcher-cadence) - 180ms)
          cubic-bezier(0.16, 1, 0.3, 1) 1 forwards;
      }
      .console-button[data-cpk-signal-pulsing="true"]::after {
        animation-delay: 180ms;
      }
      .console-button[data-cpk-signal-pulsing="true"]
        .cpk-launcher-signal-wash {
        animation: cpk-launcher-wash var(--cpk-launcher-cadence) ease-in-out 1
          both;
      }

      /*
       * The dot's centre sits exactly ON the button's outer rim at 45°, where
       * 0.35355 is 0.5 x cos45. Lengths rather than percentage offsets:
       * percentages resolve against the padding box, which the border insets,
       * and the dot would land a pixel inside the rim.
       */
      .cpk-launcher-signal-dot {
        position: absolute;
        z-index: 3;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%)
          translate(
            calc(var(--cpk-launcher-size) * 0.35355),
            calc(var(--cpk-launcher-size) * -0.35355)
          );
        width: 19%;
        height: 19%;
        border-radius: 50%;
        /* Lit from the upper left and shaded at the lower right, so the dot
           reads as a lens rather than a flat disc. Both stops are derived from
           the signal colour, so a new tone needs no new values. */
        background: radial-gradient(
          circle at 32% 28%,
          color-mix(in srgb, var(--cpk-launcher-signal), white 40%) 0%,
          var(--cpk-launcher-signal) 60%,
          color-mix(in srgb, var(--cpk-launcher-signal), black 20%) 100%
        );
        /* Replaces an opaque 1.5px collar in the launcher's own face. That
           collar was 21% of the dot's footprint, and because the dot's centre
           sits *on* the rim, its outer half painted a hard dark crescent onto
           the host page rather than onto the launcher. A hairline plus a soft
           drop does the same separating job without the hard edge. */
        box-shadow:
          0 0 0 0.5px rgba(1, 5, 7, 0.4),
          0 1px 2.5px rgba(1, 5, 7, 0.5);
      }

      /* ── Launcher pill: the launcher opens sideways and says what ─── */
      /*
       * The pill is laid out at its FULL width from the first frame and
       * revealed by animating a rectangular clip. Nothing is scaled and
       * nothing is resized.
       *
       * That is not a stylistic choice. This component is permanently mounted
       * on top of a customer's application, so no property that forces a
       * layout on every frame is acceptable — and animating "width" does
       * exactly that, sixty times a second, on someone else's page. A clip
       * leaves the element's geometry constant and changes only the visible
       * region, which the compositor handles. Animating a horizontal scale
       * was the other candidate and squashes the mark itself, not merely the
       * rounded end, so the logo would need counter-scaling and the dot and
       * halo would become ellipses.
       *
       * The launcher's own face and border are repeated here so the two form
       * one capsule: the button paints last and therefore on top, with no
       * z-index needed. The mark's own ring and shadow are deliberately left
       * alone for the whole gesture — the circle's outline staying visible
       * inside the open pill was looked at against the alternative and kept.
       *
       * A column, not a row: the pill carries a heading and a subline stacked,
       * centred against a height that does not change. "justify-content"
       * centres the pair vertically and "align-items" keeps both lines flush
       * left, so the pill never grows taller than the launcher it opens from.
       */
      .cpk-launcher-pill {
        position: absolute;
        top: 50%;
        margin-top: calc(var(--cpk-launcher-size) / -2);
        height: var(--cpk-launcher-size);
        display: inline-flex;
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        gap: 1px;
        box-sizing: border-box;
        border-radius: 999px;
        border: 1px solid var(--cpk-launcher-edge);
        background: var(--cpk-launcher-face);
        color: #ffffff;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
      }

      /* The failure class, word-identical to the panel's own wording. */
      .cpk-launcher-pill__heading {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
      }

      /*
       * The one line of copy in this feature that exists nowhere else in the
       * product. The heading above is word-identical to the panel, which is
       * the standing rule; this line is a deliberate, owner-approved exception
       * to it, because the pill is now clickable and has to say so.
       *
       * It is NOT spoken. A screen-reader user cannot act on an instruction
       * delivered through an announcement, and it would double the spoken
       * length — so the live region carries the failure class alone.
       */
      .cpk-launcher-pill__subline {
        font-size: 10.5px;
        font-weight: 500;
        line-height: 1.2;
        opacity: 0.72;
      }

      /*
       * Two directions, one animation with the inset on the other side. The
       * padding on the launcher's side clears the mark, so the words never sit
       * under it. The text-side padding is derived from the capsule's radius
       * (half the launcher size), NOT a bare literal: padding is measured from
       * the bounding box, but the first half-height of that side is the rounded
       * cap. Half the size lands the text exactly where the cap ends and the
       * straight edge begins. A literal 14px put it 16px inside the curve at the
       * production launcher size, which is itself a clamp on the viewport.
       */
      .cpk-launcher-pill[data-cpk-pill-direction="left"] {
        right: 0;
        padding: 0 calc(var(--cpk-launcher-size) + 12px) 0
          calc(var(--cpk-launcher-size) / 2);
        clip-path: inset(0 0 0 calc(100% - var(--cpk-launcher-size)));
      }
      .cpk-launcher-pill[data-cpk-pill-direction="right"] {
        left: 0;
        padding: 0 calc(var(--cpk-launcher-size) / 2) 0
          calc(var(--cpk-launcher-size) + 12px);
        clip-path: inset(0 calc(100% - var(--cpk-launcher-size)) 0 0);
      }

      /*
       * "round" on both stops, so the revealing edge is the capsule's own
       * rounded end travelling sideways rather than a straight vertical line
       * wiping across it. An unrounded inset reads as a wipe; this reads as an
       * opening. It adds no animated property: the clip is still the clip.
       */
      @keyframes cpk-launcher-pill-left {
        0% {
          opacity: 0;
          clip-path: inset(
            0 0 0 calc(100% - var(--cpk-launcher-size)) round 999px
          );
        }
        100% {
          opacity: 1;
          clip-path: inset(0 0 0 0 round 999px);
        }
      }

      @keyframes cpk-launcher-pill-right {
        0% {
          opacity: 0;
          clip-path: inset(
            0 calc(100% - var(--cpk-launcher-size)) 0 0 round 999px
          );
        }
        100% {
          opacity: 1;
          clip-path: inset(0 0 0 0 round 999px);
        }
      }

      /*
       * The pill takes the pointer exactly while it is on screen, so the
       * instruction it now carries is honest: a click on it opens the
       * Inspector, the same action as pressing the mark. During the beat the
       * clip covers only the mark itself, and a click target nobody can see
       * over someone else's page is not something to ship — so the base rule
       * keeps "pointer-events: none" and only the three visible phases take it
       * back.
       * The button paints last and therefore wins the pointer where the two
       * overlap, so dragging the launcher is unaffected throughout.
       */
      .cpk-launcher-pill[data-cpk-pill-phase="opening"],
      .cpk-launcher-pill[data-cpk-pill-phase="holding"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        pointer-events: auto;
        cursor: pointer;
      }

      /* Closing is the same animation played backwards, so the two phases can
         never drift apart. */
      .cpk-launcher-pill[data-cpk-pill-phase="opening"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
        animation-iteration-count: 1;
        animation-fill-mode: forwards;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"] {
        animation-duration: var(--cpk-launcher-pill-open);
      }
      .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
        animation-duration: var(--cpk-launcher-pill-close);
        animation-direction: reverse;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"][data-cpk-pill-direction="left"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"][data-cpk-pill-direction="left"] {
        animation-name: cpk-launcher-pill-left;
      }
      .cpk-launcher-pill[data-cpk-pill-phase="opening"][data-cpk-pill-direction="right"],
      .cpk-launcher-pill[data-cpk-pill-phase="closing"][data-cpk-pill-direction="right"] {
        animation-name: cpk-launcher-pill-right;
      }

      /* The hold is the end state of the reveal, held. */
      .cpk-launcher-pill[data-cpk-pill-phase="holding"] {
        opacity: 1;
        clip-path: inset(0 0 0 0);
      }

      /*
       * Reduced motion: the halo is held statically rather than animated, so
       * the information arrives without the movement.
       */
      @media (prefers-reduced-motion: reduce) {
        /*
         * The pill is shown by opacity alone, with no clip animation and the
         * same hold. The instruction is to reduce motion, not to withhold
         * information, and this reader needs the label as much as anyone.
         */
        .cpk-launcher-pill[data-cpk-pill-phase="opening"],
        .cpk-launcher-pill[data-cpk-pill-phase="holding"],
        .cpk-launcher-pill[data-cpk-pill-phase="closing"] {
          animation: none !important;
          opacity: 1;
          clip-path: inset(0 0 0 0);
        }
        .cpk-launcher-signal-wash {
          opacity: 0.85;
        }
        .console-button[data-cpk-signal]::before {
          opacity: 0.5;
        }
        .console-button[data-cpk-signal]::after {
          opacity: 0;
        }
        .console-button[data-cpk-signal-pulsing="true"]::before,
        .console-button[data-cpk-signal-pulsing="true"]::after {
          animation: none !important;
        }
        .console-button[data-cpk-signal-pulsing="true"]
          .cpk-launcher-signal-wash {
          animation: none !important;
        }
      }

      /* ── Launcher HUD: hover menu, quieter than the error island ── */
      .console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-hud {
        pointer-events: auto;
        opacity: 1;
        transform: none;
        visibility: visible;
      }

      .cpk-launcher-hud {
        position: absolute;
        top: 0;
        z-index: 4;
        padding-right: 14px;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transform: translateX(8px);
        transition:
          opacity 160ms ease,
          transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] {
        right: 100%;
        padding-right: 14px;
        padding-left: 0;
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] {
        left: 100%;
        right: auto;
        padding-right: 0;
        padding-left: 14px;
        transform: translateX(-8px);
      }

      .console-button-wrapper[data-cpk-hud="open"]
        .cpk-launcher-hud[data-cpk-hud-side="right"] {
        transform: none;
      }

      .cpk-launcher-hud__card {
        --hud-fill: var(--cpk-inspector-surface-dark);
        --hud-line: rgb(190 194 255 / 0.5);
        position: relative;
        width: 228px;
        padding: 4px;
        border: 1px dotted var(--hud-line);
        border-radius: var(--cpk-inspector-shell-radius);
        background: var(--hud-fill);
        color: #fff;
        backdrop-filter: blur(12px) saturate(1.2);
        box-shadow: 0 8px 20px rgb(1 5 7 / 0.18);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__card {
        --hud-fill: #fff;
        --hud-line: #d8d8e8;
        color: #010507;
      }

      .cpk-launcher-hud__arrow {
        position: absolute;
        top: calc(var(--cpk-launcher-size) / 2);
        width: 10px;
        height: 10px;
        background: var(--hud-fill);
        transform: translateY(-50%) rotate(45deg);
      }

      .cpk-launcher-hud[data-cpk-hud-side="left"] .cpk-launcher-hud__arrow {
        right: -5px;
        border-top: 1px solid var(--hud-line);
        border-right: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud[data-cpk-hud-side="right"] .cpk-launcher-hud__arrow {
        left: -5px;
        border-bottom: 1px solid var(--hud-line);
        border-left: 1px solid var(--hud-line);
      }

      .cpk-launcher-hud__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .cpk-launcher-hud__list + .cpk-launcher-hud__list {
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px dotted var(--hud-line);
      }

      .cpk-launcher-hud__row {
        position: relative;
        display: grid;
        grid-template-columns: 1fr 28px;
        align-items: start;
        border-radius: 7px;
        cursor: pointer;
      }

      .cpk-launcher-hud__row + .cpk-launcher-hud__row {
        margin-top: 1px;
      }

      .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud__row:focus-within,
      .cpk-launcher-hud__row[data-cpk-hud-help="open"] {
        background: rgb(255 255 255 / 0.06);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:hover,
      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row:focus-within,
      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__row[data-cpk-hud-help="open"] {
        background: #f0f0f4;
      }

      .cpk-launcher-hud__action {
        display: flex;
        gap: 8px;
        min-height: 32px;
        align-items: center;
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: #fff;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        text-align: start;
        cursor: pointer;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__action {
        color: #010507;
      }

      /* Stretch the row action over the whole tab, including the detail
         copy. The help mark sits above this layer. */
      .cpk-launcher-hud__action::after {
        content: "";
        position: absolute;
        inset: 0;
      }

      .cpk-launcher-hud__check {
        flex: none;
        width: 14px;
        height: 14px;
        color: #34d399;
      }

      .cpk-launcher-hud__help {
        position: relative;
        z-index: 1;
        display: inline-flex;
        width: 28px;
        height: 32px;
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

      .cpk-launcher-hud__help span {
        display: inline-flex;
        width: 16px;
        height: 16px;
        align-items: center;
        justify-content: center;
        border: 1px dotted rgb(190 194 255 / 0.55);
        border-radius: 50%;
        line-height: 1;
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__help {
        color: #68686e;
      }

      .cpk-launcher-hud__help:focus-visible,
      .cpk-launcher-hud__action:focus-visible {
        outline: 2px solid #bec2ff;
        outline-offset: 1px;
      }

      .cpk-launcher-hud__detail {
        grid-column: 1 / -1;
        max-height: 0;
        margin: 0;
        padding: 0 8px;
        overflow: hidden;
        color: rgb(255 255 255 / 0.78);
        font-size: 11px;
        font-weight: 400;
        line-height: 1.4;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-6px);
        transition:
          max-height 200ms cubic-bezier(0.16, 1, 0.3, 1),
          opacity 150ms ease-out,
          transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
          padding-bottom 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .cpk-launcher-hud[data-color-scheme="light"] .cpk-launcher-hud__detail {
        color: #68686e;
      }

      .cpk-launcher-hud__row:hover .cpk-launcher-hud__detail,
      .cpk-launcher-hud__row:focus-within .cpk-launcher-hud__detail,
      .cpk-launcher-hud__row[data-cpk-hud-help="open"] .cpk-launcher-hud__detail {
        max-height: 72px;
        padding: 0 8px 7px;
        opacity: 1;
        transform: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .cpk-launcher-hud,
        .cpk-launcher-hud__detail {
          transition: none;
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
        background: linear-gradient(
          90deg,
          #ffffff 0%,
          #f3f1ff 58%,
          #eefbf7 100%
        ) !important;
        color: #010507 !important;
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
      .cpk-threads-overview-video-frame {
        position: relative;
        display: block;
        width: 100%;
        max-width: 440px;
        aspect-ratio: 16 / 9;
        margin: 0 0 14px;
        overflow: hidden;
        border: 1px solid #dbdbe5;
        border-radius: 10px;
        background:
          linear-gradient(
            135deg,
            rgba(190, 194, 255, 0.18),
            rgba(133, 236, 206, 0.12)
          ),
          #ffffff;
        box-shadow: 0 8px 20px rgba(1, 5, 7, 0.08);
      }
      .cpk-threads-overview-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
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
        justify-content: center !important;
        align-items: center !important;
        gap: 0 !important;
        padding-inline: 0 !important;
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

      /* ── Agent/context dropdown ──────────────────────────────────── */
      [data-context-dropdown-root="true"] > button {
        border-color: #dbdbe5 !important;
        color: #010507 !important;
      }
      [data-context-dropdown-root="true"] > button:hover {
        border-color: #bec2ff !important;
        background-color: #f7f7f9 !important;
      }
      [data-context-dropdown-root="true"] > button > span:last-child {
        color: #68686e !important;
      }
      [data-context-dropdown-root="true"] > div {
        border-color: #dbdbe5 !important;
        box-shadow: 0 4px 12px rgba(1, 5, 7, 0.08) !important;
      }
      [data-context-dropdown-root="true"] > div button:hover,
      [data-context-dropdown-root="true"] > div button:focus {
        background-color: #eceafa !important;
        color: #2f1664 !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button {
        border-color: #d8d8e8 !important;
        background-color: rgba(255, 255, 255, 0.7) !important;
        color: #010507 !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button:hover {
        border-color: #a5a9ee !important;
        background-color: #ffffff !important;
      }
      .inspector-sidebar
        .inspector-agent-selector
        > [data-context-dropdown-root="true"]
        > button
        > span:last-child {
        color: #68686e !important;
      }

      /* ── Resize handle ───────────────────────────────────────────── */
      .resize-handle {
        color: #68686e !important;
      }
      .resize-handle:hover {
        color: #57575b !important;
      }

      /* ── AG-UI Events tab ────────────────────────────────────────── */
      /* Row hover: replace blue tint with brand lilac */
      tr:hover td {
        background-color: rgba(190, 194, 255, 0.08) !important;
      }
      /* Reset/dark action button */
      button[class*="bg-gray-900"] {
        background-color: #010507 !important;
      }
      button[class*="bg-gray-800"] {
        background-color: #2b2b2b !important;
      }
      /* Copy "copied" state: generic green → brand mint */
      button[class*="bg-green-100"] {
        background-color: rgba(133, 236, 206, 0.2) !important;
        color: #087653 !important;
      }

      /* ── Agents tab ──────────────────────────────────────────────── */
      /* Agent icon bubble: blue → lilac */
      span[class*="bg-blue-100"]:not([class*="text-blue-800"]) {
        background-color: rgba(190, 194, 255, 0.15) !important;
      }
      span[class*="text-blue-600"] {
        color: #5558b2 !important;
      }
      /* Running badge: emerald → mint */
      span[class*="bg-emerald-50"] {
        background-color: rgba(133, 236, 206, 0.15) !important;
      }
      span[class*="text-emerald-700"] {
        color: #087653 !important;
      }
      /* Running status dot */
      span[class*="bg-emerald-500"] {
        background-color: #85ecce !important;
      }
      /* Idle dot */
      span[class*="bg-gray-400"] {
        background-color: #afafb7 !important;
      }
      /* User role badge (blue → lilac) */
      span[class*="bg-blue-100"][class*="text-blue-800"] {
        background-color: rgba(190, 194, 255, 0.22) !important;
        border: 1px solid rgba(190, 194, 255, 0.45) !important;
        color: #57575b !important;
      }
      /* Assistant role badge (green → mint) */
      span[class*="bg-green-100"][class*="text-green-800"] {
        background-color: rgba(133, 236, 206, 0.18) !important;
        border: 1px solid rgba(133, 236, 206, 0.4) !important;
        color: #087653 !important;
      }
      /* Tool role badge (amber → orange brand) */
      span[class*="bg-amber-100"][class*="text-amber-800"] {
        background-color: rgba(255, 172, 77, 0.15) !important;
        color: #57575b !important;
      }

      /* ── Frontend Tools tab ──────────────────────────────────────── */
      /* Handler badge (blue → lilac) */
      span[class*="bg-blue-50"][class*="text-blue-700"] {
        background-color: rgba(190, 194, 255, 0.12) !important;
        border-color: rgba(190, 194, 255, 0.3) !important;
        color: #010507 !important;
      }
      /* Renderer badge (purple → lilac-adjacent) */
      span[class*="bg-purple-50"][class*="text-purple-700"] {
        background-color: rgba(190, 194, 255, 0.12) !important;
        border-color: rgba(190, 194, 255, 0.3) !important;
        color: #57575b !important;
      }
      /* Required badge (rose → brand red) */
      span[class*="bg-rose-50"][class*="text-rose-700"] {
        background-color: rgba(250, 95, 103, 0.1) !important;
        border-color: rgba(250, 95, 103, 0.25) !important;
        color: #fa5f67 !important;
      }
      /* Code/default value blocks */
      code[class*="bg-gray-100"],
      span[class*="bg-gray-100"] {
        background-color: #f0f0f4 !important;
      }

      /* ── Connected status bar: match threads header mint (#5BE4BB) ──── */
      /* Outer strip bg + top border + text when connected badge is present */
      .inspector-window
        > div
        > div:last-child
        > div:last-child:has(div[class*="bg-emerald-50"]) {
        background-color: rgba(91, 228, 187, 0.08) !important;
        border-top-color: rgba(91, 228, 187, 0.3) !important;
        color: #087653 !important;
      }
      /* Inner badge — slightly more opaque on the mint bg */
      div[class*="bg-emerald-50"][class*="border-emerald-200"] {
        background-color: rgba(91, 228, 187, 0.12) !important;
        border-color: rgba(91, 228, 187, 0.4) !important;
        color: #087653 !important;
      }
      div[class*="bg-emerald-50"][class*="border-emerald-200"]
        span[class*="opacity-80"] {
        opacity: 1 !important;
      }
      /* Icon bubble inside connected badge → mint tint */
      div[class*="bg-emerald-50"] span[class*="bg-white"] {
        background-color: rgba(91, 228, 187, 0.3) !important;
      }

      /* ── Announcement panel ──────────────────────────────────────── */
      div[class*="border-slate-200"][class*="bg-white"] {
        border-color: #dbdbe5 !important;
      }
      /* Announcement icon bubble: black → brand light lavender + lilac icon */
      span[class*="bg-slate-900"],
      div[class*="bg-slate-900"] {
        background-color: #eee6fe !important;
        color: #5558b2 !important;
      }
      span[class*="text-slate-800"],
      div[class*="text-slate-800"] {
        color: #010507 !important;
      }
    `,
];
