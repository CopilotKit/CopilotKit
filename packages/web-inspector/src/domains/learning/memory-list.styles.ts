import { css } from "lit";

export const memoryListStyles = css`
  @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .cpk-ml {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #f7f7f9;
    font-family: "Plus Jakarta Sans", sans-serif;
  }

  .cpk-ml__search {
    flex-shrink: 0;
    padding: 10px 12px;
    border-bottom: 1px solid #dbdbe5;
  }

  .cpk-ml__search-input,
  .cpk-ml__recall-input {
    box-sizing: border-box;
    border: 1px solid #dbdbe5;
    border-radius: 7px;
    background: #ffffff;
    padding: 7px 10px;
    color: #010507;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    transition: border-color 0.15s;
  }

  .cpk-ml__search-input {
    width: 100%;
  }

  .cpk-ml__search-input:focus-visible,
  .cpk-ml__recall-input:focus-visible,
  .cpk-ml__filter-seg:focus-visible,
  .cpk-ml__recall-btn:focus-visible,
  .cpk-ml__recall-clear:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }

  .cpk-ml__filter {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 12px;
    border-bottom: 1px solid #dbdbe5;
  }

  .cpk-ml__filter-seg {
    border: 1px solid #dbdbe5;
    border-radius: 6px;
    background: #ffffff;
    padding: 3px 9px;
    color: #57575b;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    transition:
      background 0.1s,
      border-color 0.1s,
      color 0.1s;
  }

  .cpk-ml__filter-seg:hover {
    background: #f0f0f5;
  }

  .cpk-ml__filter-seg--active {
    border-color: #bec2ff;
    background: #bec2ff1a;
    color: #010507;
  }

  .cpk-ml__filter-count {
    margin-left: 4px;
    color: #68686e;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
  }

  .cpk-ml__list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding: 8px 12px;
  }

  .cpk-ml__card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid #e9e9ef;
    border-radius: 10px;
    background: #ffffff;
    padding: 10px 12px;
  }

  .cpk-ml__card-badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .cpk-ml__kind-badge,
  .cpk-ml__scope-badge {
    border-radius: 5px;
    padding: 1px 7px;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .cpk-ml__kind-badge--topical {
    background: #eee6fe;
    color: #57575b;
  }

  .cpk-ml__kind-badge--episodic {
    background: #e6f4fe;
    color: #2d5f80;
  }

  .cpk-ml__kind-badge--operational {
    background: #e6feee;
    color: #2d6645;
  }

  .cpk-ml__scope-badge,
  .cpk-ml__scope-badge--user {
    background: #f0f0f5;
    color: #68686e;
  }

  .cpk-ml__scope-badge--project {
    background: #fef3c7;
    color: #92660c;
  }

  .cpk-ml__content {
    color: #010507;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .cpk-ml__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
  }

  .cpk-ml__footer-threads {
    color: #68686e;
    font-size: 10px;
  }

  .cpk-ml__footer-id {
    color: #c0c0c8;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
  }

  .cpk-ml__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: #68686e;
    font-size: 12px;
    text-align: center;
  }

  .cpk-ml__empty-icon {
    color: #c0c0c8;
  }

  .cpk-ml__recall {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid #dbdbe5;
  }

  .cpk-ml__recall-input {
    flex: 1;
  }

  .cpk-ml__recall-btn {
    border: 1px solid #dbdbe5;
    border-radius: 7px;
    background: #ffffff;
    padding: 7px 12px;
    color: #010507;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s;
  }

  .cpk-ml__recall-btn:hover:not(:disabled) {
    background: #f0f0f5;
  }

  .cpk-ml__recall-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cpk-ml__recall-section {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 8px;
    max-height: 45%;
    overflow-y: auto;
    border-bottom: 1px solid #dbdbe5;
    background: #fbfbfd;
    padding: 8px 12px;
  }

  .cpk-ml__recall-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cpk-ml__recall-title {
    color: #010507;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    font-weight: 600;
  }

  .cpk-ml__recall-clear {
    border: 0;
    background: none;
    padding: 3px;
    color: #68686e;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 10px;
    cursor: pointer;
  }

  .cpk-ml__recall-clear:hover {
    color: #010507;
  }

  .cpk-ml__recall-msg {
    color: #68686e;
    font-size: 11px;
    line-height: 1.45;
  }

  .cpk-ml__recall-msg--error {
    color: #c0333a;
  }

  .cpk-ml__relevance {
    width: 100%;
    height: 4px;
    overflow: hidden;
    border-radius: 9999px;
    background: #f0f0f5;
  }

  .cpk-ml__relevance-fill {
    height: 100%;
    border-radius: 9999px;
    background: #6366f1;
  }

  :host([data-color-scheme="dark"]) {
    color-scheme: dark;
  }

  :host([data-color-scheme="dark"]) .cpk-ml {
    background: #15171e;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__search,
  :host([data-color-scheme="dark"]) .cpk-ml__filter,
  :host([data-color-scheme="dark"]) .cpk-ml__recall,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-section,
  :host([data-color-scheme="dark"]) .cpk-ml__card {
    border-color: #343742;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__search-input,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-input,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-btn,
  :host([data-color-scheme="dark"]) .cpk-ml__filter-seg,
  :host([data-color-scheme="dark"]) .cpk-ml__card {
    border-color: #464957;
    background: #191c24;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__recall-section {
    background: #171a22;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__filter-seg:hover,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-btn:hover:not(:disabled) {
    background: #20232d;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__filter-seg--active {
    border-color: #777aae;
    background: #292b43;
    color: #d8d9ff;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__content,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-title {
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-ml__filter-count,
  :host([data-color-scheme="dark"]) .cpk-ml__footer-threads,
  :host([data-color-scheme="dark"]) .cpk-ml__footer-id,
  :host([data-color-scheme="dark"]) .cpk-ml__empty,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-clear,
  :host([data-color-scheme="dark"]) .cpk-ml__recall-msg {
    color: #aeb1bd;
  }
`;
