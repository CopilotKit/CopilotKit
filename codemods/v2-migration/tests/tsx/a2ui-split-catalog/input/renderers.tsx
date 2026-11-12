"use client";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { MyDefinitions } from "./definitions";

export const myRenderers: CatalogRenderers<MyDefinitions> = {
  Row: ({ props, children }) => (
    <div style={{ gap: props.gap }}>
      {props.children.map((id) => children(id))}
    </div>
  ),
  Card: ({ props, children }) => (
    <section>
      <h2>{props.title}</h2>
      {props.child && children(props.child)}
    </section>
  ),
  PrimaryButton: ({ props, dispatch }) => (
    <button onClick={() => props.action && dispatch?.(props.action)}>
      {props.label}
    </button>
  ),
  Metric: ({ props }) => (
    <dl>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </dl>
  ),
};
