import { css } from "lit";

/** Article styles for the Inspector’s What’s New view. */
export const notificationArticleStyles = css`
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
    padding: 3px 8px;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: #e6e8f2;
    background: #1f222d;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .announcement-code__copy:hover {
    background: #2a2e3c;
  }
  .announcement-code__copy[data-copied="true"] {
    background: #eee6fe;
    color: #6430ab;
    border-color: transparent;
  }

  .inspector-whats-new-document {
    min-width: 0;
    padding: 0 0 24px;
    overflow-wrap: anywhere;
  }

  .inspector-whats-new-document-header {
    display: grid;
    gap: 10px;
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--updates-border);
  }

  .inspector-whats-new-document-header h1 {
    margin: 0;
    color: var(--updates-text);
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.35;
  }

  .inspector-whats-new-document-header time {
    color: var(--updates-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .inspector-whats-new-document .announcement-content {
    color: #2b2b39;
    font-size: 14px;
    line-height: 1.75;
  }

  .inspector-whats-new-document .announcement-content h1,
  .inspector-whats-new-document .announcement-content h2 {
    margin: 28px 0 12px;
    color: var(--updates-text);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.4;
  }

  .inspector-whats-new-document .announcement-content > :first-child {
    margin-top: 0;
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
`;
