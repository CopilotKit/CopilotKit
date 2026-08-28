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
  if (!announcement.shouldArm) return nothing;
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

export function renderAnnouncementsView(
  announcement: AnnouncementReady | null,
  loaded: boolean,
  contentClick: (event: Event) => void,
) {
  const state = announcement?.documentHtml
    ? "content"
    : loaded
      ? "empty"
      : "loading";
  const updatedAt = announcement ? new Date(announcement.timestamp) : null;
  const updatedLabel =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? new Intl.DateTimeFormat(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        }).format(updatedAt)
      : null;
  return html`
    <div
      class="inspector-home inspector-whats-new"
      data-inspector-whats-new
      data-cpk-whats-new
      data-cpk-whats-new-state=${state}
    >
      <header class="inspector-whats-new-header">
        <h1 class="inspector-home-title">What's New</h1>
        ${
          updatedLabel && announcement
            ? html`<p class="inspector-whats-new-updated">
              Updated
              <time datetime=${updatedAt?.toISOString()}>${updatedLabel}</time>
            </p>`
            : nothing
        }
      </header>
      <section class="inspector-home-news" aria-label="CopilotKit updates">
        ${
          announcement?.documentHtml
            ? html`<article class="inspector-whats-new-document">
              <div class="announcement-content" @click=${contentClick}>
                ${unsafeHTML(announcement.documentHtml)}
              </div>
            </article>`
            : html`
                <article class="inspector-whats-new-empty">
                  <h2 class="inspector-home-card-title">You're all caught up</h2>
                  <p class="inspector-home-card-copy">
                    Latest CopilotKit updates will appear here.
                  </p>
                </article>
              `
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
): HTMLAnchorElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const link = target.closest("a");
  return link instanceof HTMLAnchorElement ? link : null;
}
