// Fixture for the generative-ui/native contract's no-false-positive direction.
// It imports plain `react`, and mentions react-dom, lit, lit-html and a static
// block only as TEXT, in comments, strings and a template:
//   import { createPortal } from "react-dom";
//   import { LitElement } from "lit";
//   class Boundary { static { this.contextType = ctx; } }
import { createElement } from "react";

export const NOTES = [
  "react-dom",
  "lit",
  "lit-html",
  "class X { static { } }",
  `static {`,
];
// The gate reads this file as written, so a static FIELD and a static METHOD
// here are not blocks. In shipped source a static field is NOT safe: the build
// lowers `static contextType = …` to a static block, so source assigns such a
// static after the class instead (see the header of
// scripts/assert-headless-purity.mjs).
export class Boundary {
  static contextType = null;
  static create() {
    return createElement("div", { static: { nested: true } });
  }
  render() {
    return null;
  }
}
