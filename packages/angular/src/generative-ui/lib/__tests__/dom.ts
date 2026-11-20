import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { SurfaceRender } from "./render";

/** The element under `root` whose own text is `text`. */
export function byText(root: ParentNode, text: string): HTMLElement {
  const match = [...root.querySelectorAll<HTMLElement>("*")].find((el) =>
    [...el.childNodes].some(
      (node) => node.nodeType === 3 && node.textContent?.trim() === text,
    ),
  );
  if (!match) throw new Error(`No element with the text "${text}".`);
  return match;
}

export function query<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`No element matches "${selector}".`);
  return element;
}

/** The control that `label` labels, through its `for`. */
export function byLabel<T extends HTMLElement>(
  root: ParentNode,
  label: string,
) {
  const labels = [...root.querySelectorAll("label")];
  const match = labels.find((el) => el.textContent?.trim() === label);
  if (!match) throw new Error(`No label "${label}".`);
  const id = match.getAttribute("for");
  const control = id
    ? root.querySelector<T>(`[id="${id}"]`)
    : match.querySelector<T>("input, select, textarea");
  if (!control) throw new Error(`Label "${label}" labels nothing.`);
  return control;
}

/** The button whose text or `aria-label` is `name`. */
export const buttonNamed = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent?.trim() === name ||
      button.getAttribute("aria-label") === name,
  );

export const textOf = (root: ParentNode, selector: string) =>
  root.querySelector(selector)?.textContent?.trim();

export function click(view: SurfaceRender, element: HTMLElement) {
  view.act(() => element.click());
}

export const press = (target: EventTarget, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

export const tick = () => TestBed.inject(ApplicationRef).tick();

export const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");

/** The `src` of the image that the lightbox shows. */
export const shownSrc = () =>
  lightbox()?.querySelector("img")?.getAttribute("src");
