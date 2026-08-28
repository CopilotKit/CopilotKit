import type { CopilotKitCoreErrorCode } from "@copilotkit/core";

import type { AnnouncementReady } from "../../domains/announcements/feed.js";
import {
  saveAnnouncementPulsedTimestamp,
  saveAnnouncementReadTimestamp,
} from "../../domains/announcements/feed.js";
import { trackErrorSignalViewed } from "../../shared/telemetry/privacy.js";
import type {
  InspectorEventErrorSource,
  InspectorWiringErrorSource,
} from "../../shared/telemetry/privacy.js";
import { EDGE_MARGIN } from "../state.js";
import type { MenuKey } from "../navigation/model.js";
import {
  ERROR_GESTURE_MS,
  EVENT_ERROR_KEYS,
  HUD_ANNOUNCEMENT_TITLE_LIMIT,
  LAUNCHER_HUD_INTRO_MS,
  LAUNCHER_HUD_WIDTH,
  LAUNCHER_SIGNALS,
  LAUNCHER_SIGNAL_PRIORITY_ORDER,
  NEWS_SIGNAL_ID,
  WIRING_ERROR_KEYS,
  eventErrorKeyForCode,
  isErrorSignalKey,
  isEventErrorKey,
  isWiringErrorKey,
} from "./model.js";
import type {
  LauncherHudRowId,
  LauncherSignalDefinition,
  LauncherSignalKey,
} from "./model.js";
import { createLauncherState } from "./state.js";
import type {
  InspectorEventErrorDetails,
  LauncherPillDirection,
  LauncherPillPhase,
} from "./state.js";

type SignalPresentation = "animated" | "reduced_motion";

export type LauncherControllerHost = Readonly<{
  requestUpdate: () => void;
  isOpen: () => boolean;
  isConnected: () => boolean;
  activeRoot: () => ParentNode;
  announcement: () => AnnouncementReady | null;
  telemetryDisabled: () => boolean;
  isWiringErrorBroken: (
    source: InspectorWiringErrorSource,
    currentlyArmed: boolean,
  ) => boolean;
  isEventErrorLandingVisible: (key: InspectorEventErrorSource) => boolean;
  applyEventErrorLanding: (key: InspectorEventErrorSource) => void;
  openInspector: () => void;
  recordNewsPulse: (
    announcement: AnnouncementReady,
    presentation: SignalPresentation,
  ) => void;
}>;

export class LauncherController {
  readonly state = createLauncherState();

  constructor(private readonly host: LauncherControllerHost) {}

  get activeSignal(): LauncherSignalKey | null {
    for (const key of LAUNCHER_SIGNAL_PRIORITY_ORDER) {
      if (this.isSignalArmed(key)) return key;
    }
    return null;
  }

  get gestureLabel(): string | null {
    if (this.state.gestureSignal === null) return null;
    return LAUNCHER_SIGNALS[this.state.gestureSignal].pillLabel ?? null;
  }

  getNavigationSignalFor(key: MenuKey): LauncherSignalDefinition | null {
    for (const signalKey of LAUNCHER_SIGNAL_PRIORITY_ORDER) {
      const signal = LAUNCHER_SIGNALS[signalKey];
      if (signal.markerTarget !== key || !this.isSignalArmed(signalKey)) {
        continue;
      }
      if (signalKey === NEWS_SIGNAL_ID && !this.host.announcement()) continue;
      return signal;
    }
    return null;
  }

  private isSignalArmed(key: LauncherSignalKey): boolean {
    if (isWiringErrorKey(key)) return this.state.errorSignalArmed[key];
    if (isEventErrorKey(key)) return this.state.eventErrorArmed[key];
    return this.state.newsSignalArmed;
  }

  armEventErrorFromCode(
    code: CopilotKitCoreErrorCode,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const key = eventErrorKeyForCode(code);
    if (key === null) return;
    const agentId =
      typeof context?.agentId === "string" && context.agentId.length > 0
        ? context.agentId
        : undefined;
    const toolName =
      typeof context?.toolName === "string" && context.toolName.length > 0
        ? context.toolName
        : undefined;
    const toolCallId =
      typeof context?.toolCallId === "string" && context.toolCallId.length > 0
        ? context.toolCallId
        : undefined;
    this.armEventError(key, message, { agentId, toolName, toolCallId });
  }

  armEventError(
    key: InspectorEventErrorSource,
    message: string,
    extras: Omit<InspectorEventErrorDetails, "message"> = {},
  ): void {
    this.state.eventErrorDetails[key] = { message, ...extras };
    const wasArmed = this.state.eventErrorArmed[key];
    this.state.eventErrorArmed[key] = true;
    if (!wasArmed) this.startSignalPulse(key);
    if (this.host.isEventErrorLandingVisible(key)) {
      this.host.applyEventErrorLanding(key);
    }
    this.host.requestUpdate();
  }

  clearAllEventErrors(): void {
    for (const key of EVENT_ERROR_KEYS) {
      this.state.eventErrorDetails[key] = null;
      if (!this.state.eventErrorArmed[key]) continue;
      this.state.eventErrorArmed[key] = false;
      this.retireSignal(key);
    }
  }

  maybeCompleteEventErrorView(): void {
    for (const key of EVENT_ERROR_KEYS) {
      if (!this.state.eventErrorArmed[key]) continue;
      if (!this.host.isEventErrorLandingVisible(key)) continue;
      this.state.eventErrorArmed[key] = false;
      this.state.errorSignalViewedSources.delete(key);
      this.retireSignal(key);
      this.host.requestUpdate();
    }
  }

  armNewsSignal(options: { pulse: boolean }): void {
    const wasArmed = this.state.newsSignalArmed;
    this.state.newsSignalArmed = true;
    if (options.pulse) {
      this.startSignalPulse(NEWS_SIGNAL_ID);
    } else if (!wasArmed) {
      this.host.requestUpdate();
    }
  }

  clearNewsSignal(): void {
    if (!this.state.newsSignalArmed) return;
    this.state.newsSignalArmed = false;
    const announcement = this.host.announcement();
    if (announcement) saveAnnouncementReadTimestamp(announcement.timestamp);
    this.retireSignal(NEWS_SIGNAL_ID);
    this.host.requestUpdate();
  }

  evaluateErrorSignals(): void {
    const wasArmed = this.hasArmedWiringError();
    for (const source of WIRING_ERROR_KEYS) {
      const broken = this.host.isWiringErrorBroken(
        source,
        this.state.errorSignalArmed[source],
      );
      if (broken) {
        if (!this.state.errorSignalArmed[source]) {
          this.state.errorSignalArmed[source] = true;
        }
        continue;
      }
      if (!this.state.errorSignalArmed[source]) continue;
      this.state.errorSignalArmed[source] = false;
      this.state.errorSignalViewedSources.delete(source);
      this.retireSignal(source);
    }
    this.onErrorSignalsChanged(wasArmed);
  }

  private hasArmedWiringError(): boolean {
    return WIRING_ERROR_KEYS.some(
      (source) => this.state.errorSignalArmed[source],
    );
  }

  private onErrorSignalsChanged(wasArmed: boolean): void {
    const isArmed = this.hasArmedWiringError();
    if (!isArmed) {
      this.state.errorBeatSpent = false;
      this.state.pillOutcome = null;
      return;
    }
    if (wasArmed || this.state.errorBeatSpent) return;
    const active = this.activeSignal;
    if (active !== null && isErrorSignalKey(active)) {
      this.startSignalPulse(active);
    }
  }

  startSignalPulse(key: LauncherSignalKey): void {
    const deferred =
      this.host.isOpen() ||
      (typeof document !== "undefined" &&
        document.visibilityState !== "visible") ||
      (this.gestureSlotSignal !== null && this.gestureSlotSignal !== key) ||
      this.activeSignal !== key;
    if (deferred) {
      const pending = this.state.pendingPulseSignal;
      if (
        pending === null ||
        LAUNCHER_SIGNALS[key].priority >= LAUNCHER_SIGNALS[pending].priority
      ) {
        this.state.pendingPulseSignal = key;
      }
      this.host.requestUpdate();
      return;
    }

    this.stopSignalPulse();
    this.state.pendingPulseSignal = null;
    this.state.pulsingSignal = key;
    if (isWiringErrorKey(key)) {
      this.state.errorBeatSpent = true;
    } else {
      const announcement = this.host.announcement();
      if (announcement && key === NEWS_SIGNAL_ID) {
        saveAnnouncementPulsedTimestamp(announcement.timestamp);
      }
    }
    this.beginGestureTail(key);
    this.host.requestUpdate();
    if (typeof window === "undefined") return;
    this.state.pulseTimeoutId = setTimeout(() => {
      this.state.pulseTimeoutId = null;
      this.state.pulsingSignal = null;
      this.host.requestUpdate();
      if (
        this.state.gestureSignal === key &&
        this.state.pillPhase === "closed"
      ) {
        this.openPill();
        return;
      }
      if (this.state.gestureSignal === key) {
        this.endGesture();
        return;
      }
      this.flushPendingSignalPulse();
    }, LAUNCHER_SIGNALS[key].cadence);
  }

  stopSignalPulse(): void {
    if (this.state.pulseTimeoutId !== null) {
      clearTimeout(this.state.pulseTimeoutId);
      this.state.pulseTimeoutId = null;
    }
    this.state.pulsingSignal = null;
  }

  flushPendingSignalPulse(): void {
    const key = this.state.pendingPulseSignal;
    if (key === null) return;
    if (!this.isSignalArmed(key)) {
      this.state.pendingPulseSignal = null;
      this.host.requestUpdate();
      return;
    }
    this.startSignalPulse(key);
  }

  private retireSignal(key: LauncherSignalKey): void {
    if (this.state.pendingPulseSignal === key) {
      this.state.pendingPulseSignal = null;
    }
    if (this.state.gestureSignal === key) this.closePillEarly();
    this.flushPendingSignalPulse();
  }

  private get gestureSlotSignal(): LauncherSignalKey | null {
    return this.state.pulsingSignal ?? this.state.gestureSignal;
  }

  private beginGestureTail(key: LauncherSignalKey): void {
    this.cancelPillTimeout();
    if (LAUNCHER_SIGNALS[key].pillLabel === undefined) {
      this.state.gestureSignal = null;
      this.state.pillPhase = null;
      this.state.pillDirection = null;
      return;
    }
    this.state.gestureSignal = key;
    this.state.pillPhase = "closed";
    this.state.pillDirection = null;
    this.closeHud();
  }

  resolvePillDirection(): void {
    if (this.state.pillDirection !== null || this.state.pillPhase === null) {
      return;
    }
    const wrapper = this.host
      .activeRoot()
      .querySelector<HTMLElement>(".console-button-wrapper");
    const button = wrapper?.querySelector<HTMLElement>(".console-button");
    const pill = wrapper?.querySelector<HTMLElement>(".cpk-launcher-pill");
    if (!button || !pill || typeof window === "undefined") return;
    const mark = button.getBoundingClientRect();
    const overhang = Math.max(
      0,
      pill.getBoundingClientRect().width - mark.width,
    );
    if (overhang === 0 || mark.left - overhang >= EDGE_MARGIN) {
      this.setPillOutcome("left");
      return;
    }
    if (mark.right + overhang <= window.innerWidth - EDGE_MARGIN) {
      this.setPillOutcome("right");
      return;
    }
    this.setPillOutcome(null);
  }

  private setPillOutcome(direction: LauncherPillDirection | null): void {
    if (direction === null) {
      this.state.pillPhase = null;
      this.state.pillDirection = null;
      this.state.pillOutcome = "suppressed";
      this.host.requestUpdate();
      return;
    }
    this.state.pillDirection = direction;
    this.state.pillOutcome = "shown";
    this.host.requestUpdate();
  }

  private openPill(): void {
    this.resolvePillDirection();
    if (this.state.pillPhase === null) {
      this.endGesture();
      return;
    }
    this.advancePill("opening", ERROR_GESTURE_MS.open, () => {
      this.advancePill("holding", ERROR_GESTURE_MS.hold, () => {
        this.advancePill("closing", ERROR_GESTURE_MS.close, () => {
          this.endGesture();
        });
      });
    });
  }

  private advancePill(
    phase: LauncherPillPhase,
    duration: number,
    next: () => void,
  ): void {
    this.cancelPillTimeout();
    this.state.pillPhase = phase;
    this.host.requestUpdate();
    if (typeof window === "undefined") return;
    this.state.pillTimeoutId = setTimeout(() => {
      this.state.pillTimeoutId = null;
      next();
    }, duration);
  }

  private closePillEarly(): void {
    if (this.state.pillPhase === null) {
      this.endGesture();
      return;
    }
    if (this.state.pillPhase === "closing") return;
    if (this.state.pillPhase === "closed") {
      this.state.pillPhase = null;
      this.host.requestUpdate();
      return;
    }
    this.advancePill("closing", ERROR_GESTURE_MS.close, () => {
      this.endGesture();
    });
  }

  private endGesture(): void {
    this.cancelGestureTail();
    this.host.requestUpdate();
    this.flushPendingSignalPulse();
  }

  cancelGestureTail(): void {
    this.cancelPillTimeout();
    this.state.gestureSignal = null;
    this.state.pillPhase = null;
    this.state.pillDirection = null;
  }

  private cancelPillTimeout(): void {
    if (this.state.pillTimeoutId !== null) {
      clearTimeout(this.state.pillTimeoutId);
      this.state.pillTimeoutId = null;
    }
  }

  maybeTrackErrorSignalViewed(): void {
    if (
      this.host.isOpen() ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const active = this.activeSignal;
    if (active === null || !isErrorSignalKey(active)) return;
    if (this.state.errorSignalViewedSources.has(active)) return;
    if (
      this.state.pillOutcome === null &&
      LAUNCHER_SIGNALS[active].pillLabel !== undefined
    ) {
      return;
    }
    if (this.host.telemetryDisabled()) return;
    this.state.errorSignalViewedSources.add(active);
    trackErrorSignalViewed({
      source: active,
      presentation: this.isReducedMotionPreferred()
        ? "reduced_motion"
        : "animated",
      label: this.state.pillOutcome ?? "suppressed",
    });
  }

  maybeTrackNewsSignalViewed(): void {
    if (
      !this.state.newsSignalArmed ||
      this.state.pulsingSignal !== NEWS_SIGNAL_ID ||
      this.host.isOpen() ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const announcement = this.host.announcement();
    if (!announcement) return;
    this.host.recordNewsPulse(
      announcement,
      this.isReducedMotionPreferred() ? "reduced_motion" : "animated",
    );
  }

  private isReducedMotionPreferred(): boolean {
    return (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  scheduleHudIntro(delay: number = LAUNCHER_HUD_INTRO_MS.delay): void {
    if (this.state.hudIntroStartTimer !== null) {
      clearTimeout(this.state.hudIntroStartTimer);
    }
    this.state.hudIntroStartTimer = setTimeout(() => {
      this.state.hudIntroStartTimer = null;
      if (!this.host.isConnected() || this.host.isOpen()) return;
      if (this.state.gestureSignal !== null) {
        this.scheduleHudIntro(LAUNCHER_HUD_INTRO_MS.blockedRetry);
        return;
      }
      this.resolveHudSide();
      this.state.hudIntro = true;
      this.state.hudOpen = true;
      this.host.requestUpdate();
      this.state.hudIntroEndTimer = setTimeout(() => {
        this.state.hudIntroEndTimer = null;
        this.state.hudIntro = false;
        this.state.hudOpen = false;
        this.host.requestUpdate();
      }, LAUNCHER_HUD_INTRO_MS.duration);
    }, delay);
  }

  cancelHudIntro(): void {
    if (this.state.hudIntroStartTimer !== null) {
      clearTimeout(this.state.hudIntroStartTimer);
      this.state.hudIntroStartTimer = null;
    }
    if (this.state.hudIntroEndTimer !== null) {
      clearTimeout(this.state.hudIntroEndTimer);
      this.state.hudIntroEndTimer = null;
    }
    if (!this.state.hudIntro) return;
    this.state.hudIntro = false;
    if (this.host.isConnected()) this.host.requestUpdate();
  }

  dispose(): void {
    this.stopSignalPulse();
    this.cancelGestureTail();
    this.cancelHudIntro();
    if (this.state.hudCloseTimer !== null) {
      clearTimeout(this.state.hudCloseTimer);
      this.state.hudCloseTimer = null;
    }
    this.state.hudOpen = false;
  }

  private resolveHudSide(): void {
    if (typeof window === "undefined") {
      this.state.hudSide = "left";
      return;
    }
    const button = this.host
      .activeRoot()
      .querySelector<HTMLElement>(".console-button");
    if (!button) {
      this.state.hudSide = "left";
      return;
    }
    const mark = button.getBoundingClientRect();
    this.state.hudSide =
      mark.left - LAUNCHER_HUD_WIDTH >= EDGE_MARGIN ? "left" : "right";
  }

  private openHud(): void {
    if (this.state.gestureSignal !== null || this.host.isOpen()) return;
    this.resolveHudSide();
    if (this.state.hudCloseTimer !== null) {
      clearTimeout(this.state.hudCloseTimer);
      this.state.hudCloseTimer = null;
    }
    if (this.state.hudOpen) return;
    this.state.hudOpen = true;
    this.host.requestUpdate();
  }

  closeHud(): void {
    this.cancelHudIntro();
    if (this.state.hudCloseTimer !== null) {
      clearTimeout(this.state.hudCloseTimer);
      this.state.hudCloseTimer = null;
    }
    if (!this.state.hudOpen) return;
    this.state.hudOpen = false;
    this.host.requestUpdate();
  }

  takeHudLandingMenu(): MenuKey | null {
    const menu = this.state.hudLandingMenu;
    this.state.hudLandingMenu = null;
    return menu;
  }

  readonly handlePillClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.host.openInspector();
  };

  readonly handleHudEnter = (): void => {
    this.cancelHudIntro();
    this.openHud();
  };

  readonly handleHudLeave = (): void => {
    if (this.state.hudCloseTimer !== null) {
      clearTimeout(this.state.hudCloseTimer);
    }
    this.state.hudCloseTimer = setTimeout(() => {
      this.state.hudCloseTimer = null;
      const wrapper = this.host
        .activeRoot()
        .querySelector<HTMLElement>(".console-button-wrapper");
      if (wrapper?.matches(":focus-within")) return;
      this.closeHud();
    }, 160);
  };

  readonly handleHudFocusIn = (): void => {
    this.cancelHudIntro();
    this.openHud();
  };

  readonly handleHudFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    const wrapper = event.currentTarget;
    if (
      next instanceof Node &&
      wrapper instanceof Node &&
      wrapper.contains(next)
    ) {
      return;
    }
    this.closeHud();
  };

  readonly handleHudKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.state.hudOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeHud();
    this.host
      .activeRoot()
      .querySelector<HTMLButtonElement>(".console-button")
      ?.focus();
  };

  readonly handleHudActionClick = (
    event: Event,
    row: LauncherHudRowId,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    this.state.hudLandingMenu =
      row === "threads" ? "threads" : "memories";
    this.closeHud();
    this.host.openInspector();
  };

  getUnreadAnnouncementTitle(): string | null {
    if (!this.state.newsSignalArmed) return null;
    const title =
      this.host.announcement()?.preview.curatedText?.trim() ||
      "New in CopilotKit";
    const titleCharacters = Array.from(title);
    return titleCharacters.length > HUD_ANNOUNCEMENT_TITLE_LIMIT
      ? `${titleCharacters
          .slice(0, HUD_ANNOUNCEMENT_TITLE_LIMIT)
          .join("")
          .trimEnd()}...`
      : title;
  }

  readonly handleHudNewsClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.state.hudLandingMenu = NEWS_SIGNAL_ID;
    this.closeHud();
    this.host.openInspector();
  };

  readonly handleHudNewsDismissClick = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.clearNewsSignal();
    this.host
      .activeRoot()
      .querySelector<HTMLButtonElement>(".console-button")
      ?.focus({ preventScroll: true });
  };

  readonly handleHudRowClick = (event: Event, row: LauncherHudRowId): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(".cpk-launcher-hud__controls, [data-cpk-hud-action]")
    ) {
      return;
    }
    this.handleHudActionClick(event, row);
  };
}
