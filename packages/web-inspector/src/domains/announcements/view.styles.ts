import { css } from "lit";

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
  @media (max-width: 480px) {
    .inspector-whats-new-header {
      width: calc(100% - 24px);
      align-items: center;
      gap: 16px;
      padding: 24px 22px;
    }
    .inspector-whats-new-document,
    .inspector-whats-new-empty {
      padding: 20px 22px 36px;
    }
    .inspector-whats-new-document .announcement-content h1 + p {
      font-size: 16px;
    }
  }
  .inspector-whats-new-header {
    display: flex;
    width: calc(100% - 44px);
    max-width: calc(70ch - 44px);
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 30px 32px 28px;
    border: 1px solid #d8d8e8;
    border-radius: 5px;
    background: #f8f7ff;
    box-shadow: 0 12px 28px rgba(38, 34, 78, 0.06);
  }
  .inspector-whats-new-header .inspector-home-title {
    margin: 0;
    font-size: clamp(27px, 3.6vw, 36px);
    letter-spacing: -0.035em;
  }
  .inspector-whats-new-updated {
    flex: none;
    margin: 0;
    color: #6c687c;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .inspector-whats-new .inspector-home-news {
    max-width: 70ch;
    margin-top: 0;
  }
  .inspector-whats-new-document,
  .inspector-whats-new-empty {
    max-width: 70ch;
    padding: 22px 32px 52px;
  }
  .inspector-whats-new-document .announcement-content {
    color: #2b2b39;
    font-size: 15px;
    line-height: 1.72;
  }
  .inspector-whats-new-document .announcement-content h1 {
    max-width: 24ch;
    margin: 0 0 16px;
    color: #15131d;
    font-size: clamp(26px, 3.2vw, 34px);
    letter-spacing: -0.032em;
    line-height: 1.1;
  }
  .inspector-whats-new-document .announcement-content h1 + p {
    max-width: 58ch;
    margin-top: 0;
    color: #504d61;
    font-size: 18px;
    line-height: 1.58;
  }
  .inspector-whats-new-document .announcement-content > hr:first-child {
    display: none;
  }
  .inspector-whats-new-document .announcement-content h2:first-of-type {
    margin-top: 14px;
    border-top: 0;
    padding-top: 0;
  }
  .inspector-whats-new-document .announcement-content h2 {
    margin: 44px 0 14px;
    padding-top: 24px;
    border-top: 1px solid #dfdeea;
    color: #1b1924;
    font-size: 21px;
    letter-spacing: -0.024em;
    line-height: 1.2;
  }
  .inspector-whats-new-document .announcement-content p {
    max-width: 70ch;
    margin: 0.85rem 0;
  }
  .inspector-whats-new-document .announcement-content ul,
  .inspector-whats-new-document .announcement-content ol {
    max-width: 68ch;
    margin: 1.25rem 0 1.5rem;
    padding-left: 1.4rem;
  }
  .inspector-whats-new-document .announcement-content li + li {
    margin-top: 0.7rem;
  }
  .inspector-whats-new-document .announcement-content a {
    color: #4e46a5;
    font-weight: 600;
    text-decoration-color: rgba(78, 70, 165, 0.42);
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
    transition:
      color 160ms ease,
      text-decoration-color 160ms ease;
  }
  .inspector-whats-new-document .announcement-content a:hover {
    color: #312879;
    text-decoration-color: currentColor;
  }
  .inspector-whats-new-empty {
    color: #5e5b70;
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
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-header {
    border-color: #3a3d49;
    background-color: #1d1e2b;
    box-shadow: none;
  }
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-updated,
  .inspector-window[data-color-scheme="dark"] .inspector-whats-new-empty {
    color: #aeb1bd;
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
    --cpk-copy-padding: 3px 8px;
    --cpk-copy-font-size: 0.6875rem;
    --cpk-copy-color: #e6e8f2;
    --cpk-copy-background: #1f222d;
    --cpk-copy-border: rgba(255, 255, 255, 0.15);
    --cpk-copy-hover-background: #2a2e3c;
    --cpk-copy-hover-color: #ffffff;
    --cpk-copy-success-background: #eee6fe;
    --cpk-copy-success-color: #6430ab;
    --cpk-copy-success-border: transparent;
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
`;
