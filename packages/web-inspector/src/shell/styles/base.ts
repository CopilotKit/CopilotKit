import { css } from "lit";

import { LAUNCHER_MAX_SIZE, LAUNCHER_MIN_SIZE } from "./tokens.js";

export const shellBaseStyles = css`
      :host {
        --cpk-inspector-shell-radius: 5px;
        --cpk-inspector-surface-dark: #111319;
        --cpk-json-key: #3d408f;
        --cpk-json-str: #0b6b4c;
        --cpk-json-num: #8a5900;
        --cpk-json-bool: #c0333a;
        --cpk-json-nil: #57575b;
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483646;
        display: block;
        will-change: transform;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      }

      :host([data-color-scheme="dark"]),
      .inspector-window[data-color-scheme="dark"] {
        --cpk-json-key: #bec2ff;
        --cpk-json-str: #85ecce;
        --cpk-json-num: #ffac4d;
        --cpk-json-bool: #fa5f67;
        --cpk-json-nil: #afafb7;
        --cpk-json-background: #111319;
        --cpk-json-color: #f3f4f8;
        --cpk-json-border: 1px solid #343742;
        --cpk-copy-border: #454956;
        --cpk-copy-background: #1d2028;
        --cpk-copy-color: #d5d7df;
        --cpk-copy-hover-background: #292d37;
        --cpk-copy-hover-color: #ffffff;
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
          scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
          background-color 200ms ease,
          border-color 200ms ease,
          box-shadow 200ms ease,
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
        background: transparent;
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
        border: 0;
        padding: 0;
      }

      .resize-handle:focus-visible,
      .dock-resize-handle:focus-visible {
        outline: 3px solid #6852ff;
        outline-offset: -3px;
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
        flex-shrink: 0;
        --cpk-copy-font-size: 0.625rem;
        --cpk-copy-font-weight: 500;
        --cpk-copy-color: #57575b;
        --cpk-copy-background: #ffffff;
        --cpk-copy-border: #dbdbe5;
        --cpk-copy-hover-background: #f0f0f4;
        --cpk-copy-hover-border: #afafb7;
        --cpk-copy-padding: 2px 8px;
        --cpk-copy-radius: 5px;
      }

      .inspector-window[data-color-scheme="dark"] .cpk-copy-btn {
        --cpk-copy-background: #191c24;
        --cpk-copy-border: #3a3d49;
        --cpk-copy-color: #f3f4f8;
        --cpk-copy-hover-background: #20232d;
        --cpk-copy-hover-border: #57575b;
      }

      .inspector-sidebar[data-icon-rail="true"]
        .inspector-sidebar-agent-scope
        [data-context-dropdown-root="true"]
        > div {
        left: 100%;
        margin-inline-start: 8px;
      }

      .inspector-icon-rail-menu {
        transform-origin: left center;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateX(-8px) scale(0.96);
        transition:
          opacity 180ms ease,
          transform 180ms ease,
          visibility 180ms ease;
      }

      .inspector-icon-rail-menu[data-open="true"] {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translateX(0) scale(1);
      }

      @media (prefers-reduced-motion: reduce) {
        .inspector-icon-rail-menu {
          transition: none;
        }
      }

      .inspector-sidebar[data-icon-rail="true"]
        .inspector-sidebar-agent-scope
        [data-context-dropdown-root="true"]
        > div::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-end: 100%;
        width: 12px;
      }

      .cpk-section-header {
        background: #e8edf5;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        padding: 10px 16px;
      }
      .inspector-window[data-color-scheme="dark"] .cpk-section-header {
        border-bottom-color: #3a3d49;
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
        transform: scale(1.05);
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
        .console-button {
          transition: opacity 160ms ease;
        }
        .console-button:hover {
          transform: none;
        }
      }
`;
