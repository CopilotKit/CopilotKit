import { css } from "lit";

export const threadListStyles = css`
  @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .cpk-tl {
    font-family: "Plus Jakarta Sans", sans-serif;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #f7f7f9;
  }

  /* ── Search ── */
  .cpk-tl__search {
    padding: 10px 12px;
    border-bottom: 1px solid #dbdbe5;
    flex-shrink: 0;
  }

  .cpk-tl__search-input {
    width: 100%;
    box-sizing: border-box;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    padding: 7px 10px;
    border-radius: 7px;
    border: 1px solid #dbdbe5;
    background: #ffffff;
    color: #010507;
    outline: none;
    transition: border-color 0.15s;
  }

  .cpk-tl__search-input:focus {
    border-color: #bec2ff;
  }

  /* ── List ── */
  .cpk-tl__list {
    flex: 1;
    overflow-y: auto;
  }

  /* ── Thread item ── */
  .cpk-tl__item {
    appearance: none;
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: 11px 13px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid #e9e9ef;
    border-left: 3px solid transparent;
    transition: background 0.1s;
  }

  .cpk-tl__item:hover {
    background: #ffffff;
  }

  .cpk-tl__item--active {
    background: #bec2ff1a;
    border-left-color: #bec2ff;
  }

  .cpk-tl__item--active:hover {
    background: #bec2ff33;
  }

  .cpk-tl__item:focus-visible {
    outline-color: #5558b2;
    outline-offset: -2px;
    outline-style: solid;
    outline-width: 2px;
  }

  .cpk-tl__row1 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 3px;
  }

  .cpk-tl__name {
    font-size: 12px;
    font-weight: 500;
    color: #010507;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cpk-tl__name--unnamed {
    color: #68686e;
    font-style: italic;
    font-weight: 400;
  }

  .cpk-tl__time {
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    color: #68686e;
    flex-shrink: 0;
  }

  .cpk-tl__meta {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }

  .cpk-tl__pill {
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    padding: 1px 7px;
    border-radius: 5px;
    text-transform: uppercase;
    font-weight: 500;
    white-space: nowrap;
    background: #eee6fe;
    color: #57575b;
  }

  .cpk-tl__pill--example {
    background: rgba(133, 236, 206, 0.22);
    color: #087653;
  }

  .cpk-tl__pill--in-app {
    background: #bec2ff;
    color: #010507;
  }

  /* ── Empty state ── */
  .cpk-tl__empty {
    padding: 32px 16px;
    text-align: center;
    color: #68686e;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .cpk-tl__empty-icon {
    color: #c0c0c8;
  }

  :host([data-color-scheme="dark"]) {
    color-scheme: dark;
  }

  :host([data-color-scheme="dark"]) .cpk-tl {
    background: #15171e;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__search,
  :host([data-color-scheme="dark"]) .cpk-tl__item {
    border-color: #343742;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__search-input {
    border-color: #464957;
    background: #191c24;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__item:hover {
    background: #20232d;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__item--active,
  :host([data-color-scheme="dark"]) .cpk-tl__item--active:hover {
    background: #292b43;
    border-left-color: #8f93df;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__name {
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__name--unnamed,
  :host([data-color-scheme="dark"]) .cpk-tl__time,
  :host([data-color-scheme="dark"]) .cpk-tl__empty {
    color: #aeb1bd;
  }

  :host([data-color-scheme="dark"]) .cpk-tl__pill {
    background: #302b43;
    color: #d8d9ff;
  }
`;
