import { css } from "lit";

export const learningSnapshotPanelStyles = css`
    .analysis-row {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .analysis-copy {
      flex: 1;
    }
    .analysis-card h2 {
      margin-bottom: 7px;
    }
    .analysis-card p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .eyebrow {
      margin: 0 0 6px !important;
      color: var(--learning-purple-dark) !important;
      font-size: 10px !important;
      font-weight: 850;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }
    .retry-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
      padding: 11px 12px;
      color: var(--learning-danger);
      background: var(--learning-soft-danger);
      border: 1px solid var(--learning-danger-border);
      border-radius: 6px;
      font-size: 11px;
    }
    .result-section {
      margin-top: 14px;
    }
    .result-section-heading {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 10px;
    }
    .result-section-heading h2 {
      margin: 0;
      font-size: 14px;
    }
    .result-count {
      color: var(--learning-muted-strong);
      font-size: 10px;
      font-weight: 700;
    }
    .review-link {
      margin-left: auto;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }
    .quiet-link {
      display: inline-flex;
      margin-top: 12px;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }
    .quiet-link:hover,
    .review-link:hover {
      text-decoration: underline;
    }
    .content-card {
      overflow: hidden;
    }
    .empty-card {
      padding: 24px;
      color: var(--learning-muted);
      background: var(--learning-surface-subtle);
      border: 1px solid var(--learning-line);
      border-radius: 8px;
    }
    .empty-card.compact {
      padding: 15px 16px;
    }
    .empty-card h3 {
      margin: 0 0 6px;
      color: var(--learning-ink);
      font-size: 14px;
    }
    .empty-card p {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
    }
    .active-skill {
      padding: 16px;
    }
    .active-skill + .active-skill {
      border-top: 1px solid var(--learning-line);
    }
    .active-skill h3 {
      margin: 0 0 6px;
      font-size: 14px;
    }
    .active-skill > p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .skill-lineage {
      margin-top: 10px;
      padding: 10px 12px;
      background: var(--learning-surface-muted);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
    }
    .skill-lineage > span {
      display: block;
      margin-bottom: 5px;
      color: var(--learning-muted-strong);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .skill-lineage button {
      display: flex;
      width: 100%;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
      padding: 0;
      color: var(--learning-ink);
      background: none;
      border: 0;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.4;
      cursor: pointer;
    }
    .skill-lineage button small {
      flex: 0 0 auto;
      color: var(--learning-purple-dark);
      font-size: 10px;
      font-weight: 750;
    }
    .supporting-unavailable {
      color: var(--learning-muted-strong);
      font-size: 11px;
      font-style: italic;
    }
    .skill-source {
      margin-top: 10px;
    }
    .skill-source summary {
      width: fit-content;
      color: var(--learning-purple-dark);
      cursor: pointer;
      font-size: 11px;
      font-weight: 750;
    }
    .skill-source pre {
      margin: 10px 0 0;
      padding: 12px;
      color: var(--learning-code);
      background: var(--learning-soft);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font:
        11px/1.5 ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .list-header {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      color: var(--learning-muted-strong);
      background: var(--learning-surface-muted);
      border-bottom: 1px solid var(--learning-line);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .list-header span:last-child {
      margin-left: auto;
    }
    .insight-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      width: 100%;
      padding: 16px;
      color: inherit;
      background: var(--learning-surface);
      border: 0;
      border-bottom: 1px solid var(--learning-line);
      text-align: left;
      cursor: pointer;
    }
    .insight-row:last-child {
      border-bottom: 0;
    }
    .insight-row:hover,
    .insight-row[data-selected="true"] {
      background: var(--learning-surface-hover);
    }
    .insight-row h3 {
      margin: 0 0 6px;
      font-size: 14px;
      line-height: 1.35;
    }
    .insight-row p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .evidence-count {
      min-width: 90px;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-align: right;
    }
    .detail-panel {
      margin-top: 14px;
      padding: 18px;
      background: var(--learning-surface-hover);
      border: 1px solid var(--learning-line-accent);
      border-radius: 8px;
    }
    .detail-head {
      display: flex;
      align-items: start;
      gap: 14px;
    }
    .detail-head div {
      flex: 1;
    }
    .detail-head h3 {
      margin: 0 0 5px;
      font-size: 14px;
    }
    .detail-head p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .close-detail {
      width: 28px;
      height: 28px;
      color: var(--learning-muted);
      background: var(--learning-surface);
      border: 1px solid var(--learning-line);
      border-radius: 5px;
      cursor: pointer;
    }
    .evidence-list {
      display: grid;
      gap: 7px;
      margin-top: 14px;
    }
    .evidence-link,
    .evidence-unavailable {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      padding: 10px;
      color: var(--learning-code);
      background: var(--learning-surface);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font-size: 11px;
      text-align: left;
    }
    .evidence-link {
      width: 100%;
      cursor: pointer;
    }
    .evidence-link span {
      margin-left: auto;
      color: var(--learning-muted-strong);
    }
    .evidence-unavailable {
      color: var(--learning-muted-strong);
      font-style: italic;
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }
    .pagination span {
      margin-right: auto;
      color: var(--learning-muted);
      font-size: 11px;
    }
    .pagination button {
      min-height: 30px;
      padding: 0 10px;
      color: var(--learning-ink);
      background: var(--learning-surface);
      border: 1px solid var(--learning-line);
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    .pagination button:disabled {
      color: var(--learning-disabled-ink);
      background: var(--learning-surface-muted);
      cursor: default;
    }
    .skeleton {
      display: grid;
      gap: 10px;
    }
    .skeleton span {
      height: 74px;
      background: linear-gradient(
        90deg,
        var(--learning-skeleton-edge),
        var(--learning-skeleton-center),
        var(--learning-skeleton-edge)
      );
      background-size: 200% 100%;
      border-radius: 8px;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    .dialog-backdrop {
      position: fixed;
      z-index: 50;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(15, 15, 20, 0.42);
    }
    .dialog {
      display: flex;
      width: min(620px, 100%);
      max-height: min(680px, 90vh);
      flex-direction: column;
      background: var(--learning-surface);
      border: 1px solid var(--learning-dialog-line);
      border-radius: 13px;
      box-shadow: 0 22px 70px rgba(0, 0, 0, 0.22);
    }
    .dialog header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      padding: 18px 19px 13px;
    }
    .dialog h2 {
      margin: 0;
      font-size: 16px;
    }
    .dialog header p {
      margin: 4px 0 0;
      color: var(--learning-muted);
      font-size: 11px;
    }
    .dialog-close {
      color: var(--learning-muted);
      background: transparent;
      border: 0;
      font-size: 20px;
      cursor: pointer;
    }
    .dialog pre {
      max-height: 420px;
      overflow: auto;
      margin: 0 19px;
      padding: 12px;
      background: var(--learning-soft);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font:
        11px/1.5 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      white-space: pre-wrap;
    }
    .dialog footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 19px 18px;
    }
    .copy-error {
      margin: 10px 19px 0;
      color: var(--learning-danger);
      font-size: 11px;
    }
    @media (max-width: 900px) {
      .steps {
        grid-template-columns: 1fr;
      }
      .step {
        min-height: auto;
      }
    }
    @media (max-width: 640px) {
      .pane-inner {
        padding: 24px 18px 60px;
      }
      .analysis-row,
      .collection-summary {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .insight-row {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .evidence-count {
        text-align: left;
      }
      .review-link {
        width: 100%;
        margin: 4px 0 0;
      }
    }
`;
