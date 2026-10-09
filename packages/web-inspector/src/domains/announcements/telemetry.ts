import {
  trackWhatsNewClicked,
  trackWhatsNewSignalViewed,
  trackWhatsNewViewed,
} from "../../shared/telemetry/privacy.js";
import type { WhatsNewSignalPresentation } from "../../shared/telemetry/privacy.js";
import type { AnnouncementReady } from "./feed.js";

const MAX_PENDING_VIEWED = 20;

/** The notification UUID identifies a notice across HUD and article events. */
export class AnnouncementTelemetry {
  private readonly viewedSignalIds = new Set<string>();
  private readonly viewedSurfaces = new Set<string>();
  private readonly clickedIds = new Set<string>();
  private pendingSignal: {
    banner_id: string;
    notification_id: string;
    surface: "launcher";
    presentation: WhatsNewSignalPresentation;
  } | null = null;
  private pendingViewed: Array<{
    banner_id: string;
    notification_id: string;
    surface: "whats_new";
  }> = [];

  recordLauncherPulse(
    announcement: AnnouncementReady,
    presentation: WhatsNewSignalPresentation,
  ): void {
    if (this.viewedSignalIds.has(announcement.id)) return;
    this.viewedSignalIds.add(announcement.id);
    this.pendingSignal = {
      banner_id: announcement.id,
      notification_id: announcement.id,
      surface: "launcher",
      presentation,
    };
  }

  recordView(announcement: AnnouncementReady): void {
    const key = `${announcement.id}:whats_new`;
    if (this.viewedSurfaces.has(key)) return;
    if (this.pendingViewed.length >= MAX_PENDING_VIEWED) return;
    this.viewedSurfaces.add(key);
    this.pendingViewed.push({
      banner_id: announcement.id,
      notification_id: announcement.id,
      surface: "whats_new",
    });
  }

  recordBodyClick(
    announcement: AnnouncementReady,
    handshakeComplete: boolean,
    telemetryDisabled: boolean,
  ): void {
    if (!handshakeComplete || telemetryDisabled) return;
    const key = `${announcement.id}:body`;
    if (this.clickedIds.has(key)) return;
    this.clickedIds.add(key);
    trackWhatsNewClicked({
      banner_id: announcement.id,
      notification_id: announcement.id,
      cta: "body",
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
