import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { DirectiveResult } from "lit/directive.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import type { AnnouncementReady } from "./feed.js";

export function renderAnnouncementPreview(
  announcement: AnnouncementReady,
  open: () => void,
  renderIcon: (
    name: "ArrowRight",
  ) => TemplateResult | DirectiveResult | typeof nothing,
) {
  if (!announcement.documentHtml) return nothing;
  return html`
    <section
      class="inspector-whats-new-preview"
      data-inspector-home-band="news"
      data-unread="true"
      role="note"
      aria-label="New CopilotKit update"
    >
      <button
        type="button"
        class="inspector-whats-new-preview-body"
        data-inspector-whats-new-preview
        aria-label="Open What's New"
        @click=${open}
      >
        <span class="inspector-whats-new-preview-copy">
          <span class="inspector-whats-new-preview-title">
            <span class="inspector-home-story-unread">New</span>
            <strong>${announcement.preview.title}</strong>
          </span>
          <span>${announcement.preview.text}</span>
        </span>
        <span class="inspector-whats-new-preview-action">
          View update ${renderIcon("ArrowRight")}
        </span>
      </button>
    </section>
  `;
}

export type AnnouncementsViewOptions = Readonly<{
  /** Eligible notices in display order. */
  notices: readonly AnnouncementReady[];
  selected: AnnouncementReady | null;
  state: "loading" | "empty" | "content";
  /** Whether "Loading updates…" can still turn into notices. */
  pending: boolean;
  isRead: (id: string) => boolean;
  onSelect: (id: string) => void;
  onBack: () => void;
  contentClick: (event: Event) => void;
  renderIcon: (
    name: "ArrowLeft" | "ChevronRight",
  ) => TemplateResult | DirectiveResult | typeof nothing;
}>;

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderAnnouncementDocument(
  selected: AnnouncementReady,
  options: AnnouncementsViewOptions,
) {
  return html`
    <button
      type="button"
      class="inspector-whats-new-back"
      @click=${options.onBack}
    >
      <span aria-hidden="true">${options.renderIcon("ArrowLeft")}</span>
      All updates
    </button>
    <article class="inspector-whats-new-document">
      <header class="inspector-whats-new-document-header">
        <h1>${selected.title}</h1>
        <time datetime=${selected.publishedAt}>
          ${formatDate(selected.publishedAt)}
        </time>
      </header>
      <div class="announcement-content" @click=${options.contentClick}>
        ${unsafeHTML(selected.documentHtml)}
      </div>
    </article>
  `;
}

function renderAnnouncementList(options: AnnouncementsViewOptions) {
  return html`
    <header class="inspector-whats-new-header">
      <h1 class="inspector-home-title">What's New</h1>
    </header>
    ${
      options.notices.length
        ? html`
          <ul class="inspector-whats-new-list">
            ${options.notices.map(
              (notice) => html`
                <li>
                  <button
                    type="button"
                    class="cpk-notification-row"
                    data-notification-id=${notice.id}
                    @click=${() => options.onSelect(notice.id)}
                  >
                    <span class="cpk-notification-copy">
                      <strong>${notice.title}</strong>
                      <span class="cpk-notification-meta">
                        <time datetime=${notice.publishedAt}
                          >${formatDate(notice.publishedAt)}</time
                        >
                        ${
                          options.isRead(notice.id)
                            ? nothing
                            : html`
                                <span class="cpk-notification-unread">Unread</span>
                              `
                        }
                      </span>
                    </span>
                    <span class="cpk-notification-chevron" aria-hidden="true"
                      >${options.renderIcon("ChevronRight")}</span
                    >
                  </button>
                </li>
              `,
            )}
          </ul>
        `
        : html`<p class="inspector-whats-new-empty" role="status">
          ${options.pending ? "Loading updates…" : "You're all caught up."}
        </p>`
    }
  `;
}

export function renderAnnouncementsView(options: AnnouncementsViewOptions) {
  return html`
    <div
      class="inspector-home inspector-whats-new"
      data-inspector-whats-new
      data-cpk-whats-new
      data-cpk-whats-new-state=${options.state}
    >
      <section class="inspector-home-news" aria-label="CopilotKit updates">
        ${
          options.selected
            ? renderAnnouncementDocument(options.selected, options)
            : renderAnnouncementList(options)
        }
      </section>
    </div>
  `;
}

export function synchronizeAnnouncementCopyControls(
  root: ParentNode,
  clipboard: Clipboard | undefined,
): void {
  for (const control of root.querySelectorAll<HTMLElement>(
    ".announcement-code__copy",
  )) {
    Reflect.set(control, "clipboard", clipboard);
  }
}

export function announcementLinkFromClick(
  event: Event,
): AnnouncementLink | null {
  const target = event.target;
  if (typeof target !== "object" || target === null) return null;
  const closest = Reflect.get(target, "closest");
  if (typeof closest !== "function") return null;
  const link: unknown = Reflect.apply(closest, target, ["a"]);
  return isAnnouncementLink(link) ? link : null;
}

type AnnouncementLink = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};

function isAnnouncementLink(value: unknown): value is AnnouncementLink {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "localName") === "a" &&
    typeof Reflect.get(value, "getAttribute") === "function" &&
    typeof Reflect.get(value, "setAttribute") === "function"
  );
}
