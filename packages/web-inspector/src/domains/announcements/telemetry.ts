import {
  trackWhatsNewClicked,
  trackWhatsNewSignalViewed,
  trackWhatsNewViewed,
} from "../../shared/telemetry/privacy.js";
import type { WhatsNewSignalPresentation } from "../../shared/telemetry/privacy.js";
import type { AnnouncementReady } from "./feed.js";

const MAX_PENDING_VIEWED = 20;

export class AnnouncementTelemetry {
  private readonly viewedSignalIds = new Set<string>();
  private readonly viewedSurfaces = new Set<string>();
  private readonly clickedIds = new Set<string>();
  private pendingSignal: {
    banner_id: string;
    surface: "launcher";
    presentation: WhatsNewSignalPresentation;
    cta_label?: string;
  } | null = null;
  private pendingViewed: Array<{
    banner_id: string;
    surface: "whats_new";
    cta_label?: string;
  }> = [];

  recordLauncherPulse(
    announcement: AnnouncementReady,
    presentation: WhatsNewSignalPresentation,
  ): void {
    if (this.viewedSignalIds.has(announcement.timestamp)) return;
    this.viewedSignalIds.add(announcement.timestamp);
    this.pendingSignal = {
      banner_id: announcement.timestamp,
      surface: "launcher",
      presentation,
      cta_label: announcement.ctaLabel,
    };
  }

  recordView(announcement: AnnouncementReady): void {
    const key = `${announcement.timestamp}:whats_new`;
    if (this.viewedSurfaces.has(key)) return;
    if (this.pendingViewed.length >= MAX_PENDING_VIEWED) return;
    this.viewedSurfaces.add(key);
    this.pendingViewed.push({
      banner_id: announcement.timestamp,
      surface: "whats_new",
      cta_label: announcement.ctaLabel,
    });
  }

  recordBodyClick(
    announcement: AnnouncementReady,
    handshakeComplete: boolean,
    telemetryDisabled: boolean,
  ): void {
    if (!handshakeComplete || telemetryDisabled) return;
    const key = `${announcement.timestamp}:body`;
    if (this.clickedIds.has(key)) return;
    this.clickedIds.add(key);
    trackWhatsNewClicked({
      banner_id: announcement.timestamp,
      cta: "body",
      cta_label: announcement.ctaLabel,
    });
  }

  flush(handshakeComplete: boolean, telemetryDisabled: boolean): void {
    if (telemetryDisabled) {
      this.pendingViewed = [];
      this.pendingSignal = null;
      return;
    }
    if (!handshakeComplete) return;
    const viewed = this.pendingViewed;
    this.pendingViewed = [];
    for (const properties of viewed) trackWhatsNewViewed(properties);
    if (this.pendingSignal) {
      const properties = this.pendingSignal;
      this.pendingSignal = null;
      trackWhatsNewSignalViewed(properties);
    }
  }
}
