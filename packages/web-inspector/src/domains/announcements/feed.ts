import { renderAnnouncementDocument } from "./document.js";
import { loadNotificationFeed } from "./notification-loader.js";
import {
  acknowledgeNotification,
  compareNotifications,
  emptyNotificationState,
  reconcileNotifications,
} from "./notifications.js";
import type {
  CohortNotification,
  NotificationContext,
  NotificationFeed,
  NotificationState,
} from "./notifications.js";
import {
  hasNotificationPulsed,
  loadNotificationState,
  migrateAnnouncementReadState,
  saveNotificationState,
} from "./storage.js";

/** One eligible notification, ready for What's New, Home, and the HUD. */
export type AnnouncementReady = Readonly<{
  id: string;
  title: string;
  publishedAt: string;
  documentHtml: string;
  preview: Readonly<{
    title: string;
    text: string;
  }>;
}>;

export type AnnouncementFeedHost = Readonly<{
  /** Targeting context, including confirmed runtime metadata. */
  context: () => NotificationContext;
  isSignalArmed: () => boolean;
  armSignal: (options: { pulse: boolean }) => void;
  retireSignal: () => void;
  requestUpdate: () => void;
}>;

/** Return a short preview from markdown, without links or headings. */
export function announcementPreview(markdown: string, maxLength = 140): string {
  const plain = markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= maxLength
    ? plain
    : `${plain.slice(0, maxLength).trimEnd()}…`;
}

function renderDocument(markdown: string): string {
  try {
    return renderAnnouncementDocument(markdown);
  } catch {
    return "";
  }
}

/**
 * Targeted What's New notifications: the feed, the reader's acknowledgements,
 * and the notice the Inspector currently highlights.
 */
export class AnnouncementFeed {
  private feed: NotificationFeed | null = null;
  private state: NotificationState = emptyNotificationState();
  private documents = new Map<string, string>();
  private selectedId: string | null = null;
  /** True once the feed request has settled, with or without a feed. */
  loaded = false;
  /** The selected notice, else the highlighted one, else the top eligible one. */
  current: AnnouncementReady | null = null;

  constructor(private readonly host: AnnouncementFeedHost) {}

  /** Restore this origin's selection and the host-wide acknowledgements. */
  restore(): void {
    this.state = loadNotificationState();
  }

  /** The highlighted notice that drives the launcher signal, if any. */
  get active(): AnnouncementReady | null {
    const notice = this.notice(this.state.activeId);
    return notice ? this.project(notice) : null;
  }

  get selected(): AnnouncementReady | null {
    const notice = this.notice(this.selectedId);
    return notice && this.state.eligibleIds.includes(notice.id)
      ? this.project(notice)
      : null;
  }

  /** Eligible notices in display order. */
  get notices(): AnnouncementReady[] {
    return this.eligible().map((notice) => this.project(notice));
  }

  isRead(id: string): boolean {
    return this.state.readIds.includes(id);
  }

  /** Load the feed and its documents, then re-evaluate the highlight. */
  async fetch(
    context: Pick<NotificationContext, "framework" | "sdkVersion">,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    try {
      const feed = await loadNotificationFeed(context);
      // A request that outlived its element must not arm or pulse the signal.
      if (!isCurrent()) return;
      if (feed) {
        this.documents = new Map(
          feed.notifications.map((notice) => [
            notice.id,
            renderDocument(notice.body),
          ]),
        );
        this.feed = feed;
      }
    } catch {
      /* Notification failures cannot disrupt the host. */
    }
    this.loaded = true;
    this.refresh();
    this.host.requestUpdate();
  }

  /** Re-evaluate eligibility, the highlight, and the launcher signal. */
  refresh(): void {
    const feed = this.feed;
    if (!feed) return;
    this.state = migrateAnnouncementReadState(this.state, feed);
    const previousActiveId = this.state.activeId;
    this.state = reconcileNotifications(this.state, feed, this.host.context());
    saveNotificationState(this.state);
    if (!this.state.eligibleIds.includes(this.selectedId ?? "")) {
      this.selectedId = null;
    }
    const notice =
      feed.notifications.find(
        (n) =>
          this.state.eligibleIds.includes(n.id) &&
          n.id === (this.selectedId ?? this.state.activeId),
      ) ?? this.eligible()[0];
    this.current = notice ? this.project(notice) : null;
    const activeId = this.state.activeId;
    const active = this.notice(activeId);
    if (activeId && active && this.state.eligibleIds.includes(activeId)) {
      this.host.armSignal({
        pulse:
          (previousActiveId !== activeId || !this.host.isSignalArmed()) &&
          !hasNotificationPulsed(activeId, active.publishedAt),
      });
    } else {
      this.host.retireSignal();
    }
    this.host.requestUpdate();
  }

  /** Open one notice and acknowledge it. */
  read(id: string): void {
    this.selectedId = id;
    this.state = acknowledgeNotification(this.state, id);
    this.refresh();
  }

  /** Return What's New to its list without changing the read state. */
  clearSelection(): void {
    this.selectedId = null;
    this.host.requestUpdate();
  }

  /** Close the highlight, which quiets its delivered backlog. */
  acknowledgeActive(): void {
    if (!this.state.activeId) return;
    this.state = acknowledgeNotification(this.state, this.state.activeId);
    this.refresh();
  }

  private notice(id: string | null): CohortNotification | undefined {
    if (!id) return undefined;
    return this.feed?.notifications.find((notice) => notice.id === id);
  }

  private eligible(): CohortNotification[] {
    return (
      this.feed?.notifications
        .filter((notice) => this.state.eligibleIds.includes(notice.id))
        .sort(compareNotifications) ?? []
    );
  }

  private project(notice: CohortNotification): AnnouncementReady {
    const heading = notice.body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    return {
      id: notice.id,
      title: notice.title,
      publishedAt: notice.publishedAt,
      documentHtml: this.documents.get(notice.id) ?? "",
      preview: {
        title: heading || "The latest from CopilotKit",
        text: notice.title.trim() || announcementPreview(notice.body, 160),
      },
    };
  }
}
