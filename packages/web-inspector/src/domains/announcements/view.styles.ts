import { css } from "lit";

import { announcementArticleStyles } from "./article.styles.js";

export const announcementViewStyles = css`
  .inspector-home-story {
    position: relative;
    border: 1px solid #deddea;
    border-radius: 5px;
    background-color: rgba(255, 255, 255, 0.82);
    padding: 18px 18px 16px;
  }
  .inspector-whats-new-preview + .inspector-home-section {
    margin-top: 20px;
  }
  .inspector-whats-new-preview {
    container-type: inline-size;
    position: relative;
    display: flex;
    width: 100%;
    min-height: 64px;
    align-items: stretch;
    overflow: hidden;
    border: 1px solid #c8c6e6;
    border-radius: 5px;
    background-color: #f7f4fe;
    color: #010507;
  }
  .inspector-whats-new-preview:has(.inspector-whats-new-preview-body:hover) {
    border-color: #8f91d7;
    background-color: #f1ebfc;
  }
  .inspector-whats-new-preview-body {
    display: grid;
    min-width: 0;
    flex: 1 1 auto;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    border: 0;
    background-color: transparent;
    padding: 12px 14px;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .inspector-whats-new-preview-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }
  .inspector-whats-new-preview-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }
  .inspector-whats-new-preview-copy strong {
    overflow: hidden;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-whats-new-preview-copy > span:last-child {
    overflow: hidden;
    color: #4e4c63;
    font-size: 11px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inspector-whats-new-preview-action {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    color: #3f176f;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
  .inspector-whats-new-preview-action svg {
    width: 15px;
    height: 15px;
  }
  @container (max-width: 640px) {
    .inspector-whats-new-preview-body {
      grid-template-columns: minmax(0, 1fr);
    }
    .inspector-whats-new-preview-action {
      display: none;
    }
  }
  .inspector-whats-new-preview-dismiss {
    position: absolute;
    top: 50%;
    right: 12px;
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 5px;
    background-color: transparent;
    color: #68686e;
    transform: translateY(-50%);
    cursor: pointer;
  }
  .inspector-whats-new-preview-dismiss:hover {
    background-color: rgba(100, 48, 171, 0.1);
    color: #3f176f;
  }
  .inspector-whats-new-preview-dismiss svg {
    width: 14px;
    height: 14px;
  }
  @media (max-width: 720px) {
    .inspector-whats-new-preview-action {
      display: none;
    }
  }
  .inspector-whats-new {
    --updates-text: #1b1924;
    --updates-muted: #6c687c;
    --updates-border: #e6e4ef;
    --updates-hover: #f8f7ff;
    --updates-accent: #6554b8;
  }
  .inspector-whats-new .inspector-home-news {
    max-width: 70ch;
    gap: 0;
    margin-top: 0;
  }
  .inspector-whats-new-header {
    padding: 0 0 24px;
    border-bottom: 1px solid var(--updates-border);
  }
  .inspector-whats-new-header .inspector-home-title {
    margin: 0;
    color: var(--updates-text);
    font-size: 24px;
    letter-spacing: -0.025em;
    line-height: 1.3;
  }
  .inspector-whats-new-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cpk-notification-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    width: 100%;
    padding: 22px 12px;
    border: 0;
    border-bottom: 1px solid var(--updates-border);
    background: transparent;
    color: var(--updates-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cpk-notification-row:hover,
  .inspector-whats-new-back:hover {
    background: var(--updates-hover);
  }
  .cpk-notification-row:focus-visible,
  .inspector-whats-new-back:focus-visible {
    outline: 2px solid var(--updates-accent);
    outline-offset: -2px;
    border-radius: 4px;
  }
  .cpk-notification-copy {
    display: grid;
    min-width: 0;
    gap: 8px;
  }
  .cpk-notification-copy strong {
    color: var(--updates-text);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .cpk-notification-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    color: var(--updates-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .cpk-notification-unread {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--updates-accent);
  }
  .cpk-notification-unread::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentcolor;
  }
  .cpk-notification-chevron,
  .inspector-whats-new-back > span {
    display: flex;
    flex: none;
    width: 16px;
    height: 16px;
    color: var(--updates-muted);
  }
  .cpk-notification-chevron svg,
  .inspector-whats-new-back svg {
    width: 100%;
    height: 100%;
  }
  .inspector-whats-new-back {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    margin: -6px 0 24px -8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--updates-muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .inspector-whats-new-empty {
    margin: 0;
    padding: 28px 0;
    color: var(--updates-muted);
    font-size: 14px;
  }
  .inspector-whats-new-empty .inspector-home-card-title {
    margin: 0;
    color: #1b1924;
  }
  .inspector-whats-new-empty .inspector-home-card-copy {
    max-width: 48ch;
    margin: 8px 0 0;
  }
  .inspector-home-story-featured {
    padding: 22px;
  }
  .inspector-home-story-link {
    display: block;
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .inspector-home-story-link:hover {
    border-color: #8f91d7;
    background-color: #ffffff;
  }
  .inspector-home-story[data-unread="true"] {
    padding-right: 64px;
    border-color: #bec2ff;
    box-shadow: 0 0 0 1px #6430ab;
  }
  .inspector-home-story-unread {
    display: inline-flex;
    min-height: 18px;
    align-items: center;
    border-radius: 999px;
    background-color: #6430ab;
    padding: 0 7px;
    color: #ffffff;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  [data-inspector-whats-new-preview]:focus-visible,
  [data-inspector-whats-new-dismiss]:focus-visible {
    outline: 2px solid #6430ab !important;
    outline-offset: 2px;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-story,
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-preview {
    border-color: #3a3d49;
    background: #191c24;
    color: #f3f4f8;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-home-story-link:hover,
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview:has(.inspector-whats-new-preview-body:hover) {
    border-color: #777aae;
    background: #242131;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview-copy
    > span:last-child {
    color: #aeb1bd;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview-dismiss {
    color: #aeb1bd;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview-dismiss:hover {
    background-color: #302a40;
    color: #ffffff;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new {
    --updates-text: #f3f4f8;
    --updates-muted: #aeb1bd;
    --updates-border: #3a3d49;
    --updates-hover: #242432;
    --updates-accent: #c4b5fd;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview-action {
    color: #d8d9ff;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-preview:hover
    .inspector-whats-new-preview-action {
    color: #ffffff;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-document,
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-empty {
    border-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content {
    color: #c9ccd6;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-empty
    .inspector-home-card-title {
    color: #f3f4f8;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    h1
    + p {
    color: #c9ccd6;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    h2 {
    border-top-color: #3a3d49;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    h1,
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    h2,
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    h3,
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    strong {
    color: #f3f4f8;
  }
  .inspector-window[data-color-scheme="dark"]
    .inspector-whats-new-document
    .announcement-content
    a {
    color: #caccff;
  }

  ${announcementArticleStyles}

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
`;
