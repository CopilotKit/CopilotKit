import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import inspectorLogoKiteUrl from "../../assets/inspector-logo-kite.svg";
import type { InspectorColorScheme } from "../contracts.js";
import { LAUNCHER_SIGNAL_COLORS } from "../styles.js";
import type { LauncherController } from "./controller.js";
import {
  ERROR_GESTURE_MS,
  HUD_INSPECTOR_LABEL,
  HUD_LEARNING_LABEL,
  HUD_LEARN_MORE_LABEL,
  HUD_THREADS_LABEL,
  LAUNCHER_BASE_LABEL,
  LAUNCHER_HUD_INTRO_MS,
  LAUNCHER_SIGNALS,
  LAUNCHER_UNREAD_LABEL,
  NEWS_SIGNAL_ID,
  PILL_SUBLINE_LABEL,
  launcherHudWaterfallDelay,
} from "./model.js";
import type { LauncherHudRowId } from "./model.js";

export type LauncherHudAvailability = Readonly<{
  threads: boolean;
  learning: boolean;
}>;

export type LauncherHudIconName =
  | "Brain"
  | "CircleHelp"
  | "Clock"
  | "MessageSquare"
  | "X";

export type LauncherViewOptions = Readonly<{
  controller: LauncherController;
  colorScheme: InspectorColorScheme;
  anchorVertical: "top" | "bottom";
  isDragging: boolean;
  pointerContextIsButton: boolean;
  getHudAvailability: () => LauncherHudAvailability;
  renderIcon: (name: LauncherHudIconName) => unknown;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
  onClick: (event: Event) => void;
}>;

export function renderLauncherView(
  options: LauncherViewOptions,
): TemplateResult {
  // Tailwind scan tokens retained for generated-sheet stability: ease-in-out
  // ease-out
  const { controller } = options;
  const { state } = controller;
  const activeSignal = controller.activeSignal;
  const signal = activeSignal ? LAUNCHER_SIGNALS[activeSignal] : null;
  const signalStyles = signal
    ? {
        "--cpk-launcher-signal": LAUNCHER_SIGNAL_COLORS[signal.tone],
        "--cpk-launcher-cadence": `${signal.cadence}ms`,
      }
    : {};
  const buttonClasses = [
    "console-button",
    "group",
    "relative",
    "pointer-events-auto",
    "inline-flex",
    "h-9",
    "w-9",
    "items-center",
    "justify-center",
    "rounded-full",
    "border",
    "text-xs",
    "font-medium",
    "text-white",
    "focus-visible:outline",
    "focus-visible:outline-2",
    "focus-visible:outline-offset-2",
    "focus-visible:outline-[#BEC2FF]",
    "touch-none",
    "select-none",
    options.isDragging ? "cursor-grabbing" : "cursor-pointer",
  ].join(" ");

  return html`
    <div
      class="console-button-wrapper"
      data-cpk-hud=${state.hudOpen ? "open" : "closed"}
      @pointerenter=${controller.handleHudEnter}
      @pointerleave=${controller.handleHudLeave}
      @focusin=${controller.handleHudFocusIn}
      @focusout=${controller.handleHudFocusOut}
      @keydown=${controller.handleHudKeydown}
    >
      ${renderLauncherPill(controller)}
      <button
        class=${buttonClasses}
        type="button"
        aria-expanded=${state.hudOpen ? "true" : "false"}
        aria-controls=${state.hudOpen ? "cpk-launcher-hud" : nothing}
        aria-label=${
          signal?.tone === "error"
            ? `${LAUNCHER_BASE_LABEL}, ${signal.accessibleLabel}`
            : activeSignal === NEWS_SIGNAL_ID
              ? `${LAUNCHER_BASE_LABEL}, ${LAUNCHER_UNREAD_LABEL}`
              : LAUNCHER_BASE_LABEL
        }
        title=${HUD_INSPECTOR_LABEL}
        data-drag-context="button"
        data-cpk-signal=${signal ? signal.tone : nothing}
        data-cpk-signal-pulsing=${
          activeSignal !== null && state.pulsingSignal === activeSignal
            ? "true"
            : nothing
        }
        style=${styleMap(signalStyles)}
        data-dragging=${
          options.isDragging && options.pointerContextIsButton
            ? "true"
            : "false"
        }
        @pointerdown=${options.onPointerDown}
        @pointermove=${options.onPointerMove}
        @pointerup=${options.onPointerUp}
        @pointercancel=${options.onPointerCancel}
        @click=${options.onClick}
      >
        <img
          src=${inspectorLogoKiteUrl}
          alt="Inspector logo"
          class="cpk-launcher-mark h-6 w-auto"
          loading="lazy"
        />
        ${
          activeSignal !== null
            ? html`<span
                class="cpk-launcher-signal-wash"
                aria-hidden="true"
              ></span>
              <span
                class="cpk-launcher-signal-dot"
                data-cpk-signal-dot=${activeSignal}
                aria-hidden="true"
              ></span>`
            : nothing
        }
      </button>
      <span
        class="sr-only"
        data-cpk-launcher-announcement
        role="status"
        aria-live="polite"
        >${controller.gestureLabel ?? ""}</span
      >
      ${renderLauncherHud(options)}
    </div>
  `;
}

function renderLauncherPill(
  controller: LauncherController,
): TemplateResult | typeof nothing {
  const { state } = controller;
  const key = state.gestureSignal;
  if (key === null || state.pillPhase === null) return nothing;
  const signal = LAUNCHER_SIGNALS[key];
  const label = signal.pillLabel;
  if (label === undefined) return nothing;
  return html`
    <span
      class="cpk-launcher-pill"
      data-cpk-launcher-pill=${key}
      data-cpk-pill-phase=${state.pillPhase}
      data-cpk-pill-direction=${state.pillDirection ?? "left"}
      style=${styleMap({
        "--cpk-launcher-signal": LAUNCHER_SIGNAL_COLORS[signal.tone],
        "--cpk-launcher-pill-open": `${ERROR_GESTURE_MS.open}ms`,
        "--cpk-launcher-pill-close": `${ERROR_GESTURE_MS.close}ms`,
      })}
      aria-hidden="true"
      @click=${controller.handlePillClick}
    >
      <span class="cpk-launcher-pill__heading" data-cpk-pill-heading
        >${label}</span
      >
      <span class="cpk-launcher-pill__subline" data-cpk-pill-subline
        >${PILL_SUBLINE_LABEL}</span
      >
    </span>
  `;
}

function renderHudRow(
  options: LauncherViewOptions,
  args: Readonly<{
    id: LauncherHudRowId;
    label: string;
    icon: LauncherHudIconName;
    connected?: boolean;
    introIndex: number;
  }>,
): TemplateResult {
  const { controller } = options;
  const detailId = `cpk-hud-detail-${args.id}`;
  return html`
    <li
      class="cpk-launcher-hud__row"
      data-cpk-hud-row=${args.id}
      data-cpk-hud-action-kind="navigate"
      style=${styleMap({
        "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(args.introIndex),
      })}
      @click=${(event: Event) => controller.handleHudRowClick(event, args.id)}
    >
      <span class="cpk-launcher-hud__primary">
        <button
          type="button"
          class="cpk-launcher-hud__action"
          data-cpk-hud-action
          aria-label=${`Open ${args.label} in Inspector`}
          @click=${(event: Event) =>
            controller.handleHudActionClick(event, args.id)}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          <span
            class="cpk-launcher-hud__feature-icon"
            data-cpk-hud-icon=${args.id}
            aria-hidden="true"
            >${options.renderIcon(args.icon)}</span
          >
          <span class="cpk-launcher-hud__label">${args.label}</span>
        </button>
        <span class="cpk-launcher-hud__tooltip" id=${detailId} role="tooltip"
          >${HUD_LEARN_MORE_LABEL}</span
        >
      </span>
      <span class="cpk-launcher-hud__controls">
        <button
          type="button"
          class="cpk-launcher-hud__learn-more"
          data-cpk-hud-learn-more=${args.id}
          aria-label=${`Learn more about ${args.label}`}
          aria-describedby=${detailId}
          @click=${(event: Event) =>
            controller.handleHudActionClick(event, args.id)}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          ${options.renderIcon("CircleHelp")}
        </button>
        <button
          type="button"
          class="cpk-launcher-hud__toggle"
          data-cpk-hud-toggle=${args.id}
          data-enabled=${args.connected ? "true" : "false"}
          aria-label=${
            args.connected
              ? `${args.label} is enabled`
              : `Open ${args.label} in Inspector`
          }
          ?disabled=${args.connected}
          @click=${(event: Event) =>
            controller.handleHudActionClick(event, args.id)}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          <span
            class="cpk-launcher-hud__toggle-track"
            aria-hidden="true"
          ></span>
        </button>
      </span>
    </li>
  `;
}

function renderLauncherHud(
  options: LauncherViewOptions,
): TemplateResult | typeof nothing {
  const { controller } = options;
  const { state } = controller;
  if (!state.hudOpen) return nothing;
  const availability = options.getHudAvailability();
  const announcementTitle = controller.getUnreadAnnouncementTitle();
  const featureBlockIntroIndex = announcementTitle ? 1 : 0;
  return html`
    <div
      class="cpk-launcher-hud"
      id="cpk-launcher-hud"
      data-cpk-launcher-hud
      data-cpk-hud-side=${state.hudSide}
      data-cpk-hud-vertical=${options.anchorVertical}
      data-cpk-hud-intro=${state.hudIntro ? "true" : nothing}
      data-color-scheme=${options.colorScheme}
      style=${styleMap({
        "--cpk-launcher-hud-intro-duration": `${LAUNCHER_HUD_INTRO_MS.duration}ms`,
        "--cpk-launcher-hud-waterfall-duration": `${LAUNCHER_HUD_INTRO_MS.waterfallDuration}ms`,
      })}
    >
      <span class="cpk-launcher-hud__arrow" aria-hidden="true"></span>
      <div class="cpk-launcher-hud__card">
        ${
          announcementTitle
            ? html`
              <div
                class="cpk-launcher-hud__masthead"
                style=${styleMap({
                  "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(0),
                })}
              >
                <div class="cpk-launcher-hud__news-wrap">
                  <button
                    type="button"
                    class="cpk-launcher-hud__news"
                    data-cpk-hud-news
                    aria-label=${`Open new notification: ${announcementTitle}`}
                    @click=${controller.handleHudNewsClick}
                    @pointerdown=${(event: Event) => event.stopPropagation()}
                  >
                    <span
                      class="cpk-launcher-hud__news-label"
                      data-cpk-hud-news-label
                      aria-hidden="true"
                      >New</span
                    >
                    <span class="cpk-launcher-hud__news-title"
                      >${announcementTitle}</span
                    >
                  </button>
                  <button
                    type="button"
                    class="cpk-launcher-hud__news-dismiss"
                    data-cpk-hud-news-dismiss
                    aria-label="Dismiss notification"
                    @click=${controller.handleHudNewsDismissClick}
                    @pointerdown=${(event: Event) => event.stopPropagation()}
                  >
                    ${options.renderIcon("X")}
                  </button>
                </div>
              </div>
            `
            : nothing
        }
        <ul
          class="cpk-launcher-hud__list cpk-launcher-hud__feature-list"
          role="list"
          style=${styleMap({
            "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(
              featureBlockIntroIndex,
            ),
          })}
        >
          ${renderHudRow(options, {
            id: "threads",
            label: HUD_THREADS_LABEL,
            icon: "MessageSquare",
            connected: availability.threads,
            introIndex: featureBlockIntroIndex + 1,
          })}
          ${renderHudRow(options, {
            id: "learning",
            label: HUD_LEARNING_LABEL,
            icon: "Brain",
            connected: availability.learning,
            introIndex: featureBlockIntroIndex + 2,
          })}
        </ul>
        <button
          type="button"
          class="cpk-launcher-hud__dismiss-day"
          data-cpk-dismiss-inspector="day"
          style=${styleMap({
            "--cpk-hud-waterfall-delay": launcherHudWaterfallDelay(
              featureBlockIntroIndex + 3,
            ),
          })}
          @click=${controller.handleHudDismissDayClick}
          @pointerdown=${(event: Event) => event.stopPropagation()}
        >
          <span aria-hidden="true">${options.renderIcon("Clock")}</span>
          Hide Inspector for a day
        </button>
      </div>
    </div>
  `;
}
