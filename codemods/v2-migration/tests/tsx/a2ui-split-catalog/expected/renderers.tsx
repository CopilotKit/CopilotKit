"use client";

import type { MyDefinitions } from "./definitions";

export const myRenderers = {
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  Row: ({ props, children }) => (
    <div style={{ gap: props.gap }}>
      {props.children.map((id) => children(id))}
    </div>
  ),
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  Card: ({ props, children }) => (
    <section>
      <h2>{props.title}</h2>
      {props.child && children(props.child)}
    </section>
  ),
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  PrimaryButton: ({ props, dispatch }) => (
    <button onClick={() => props.action && dispatch?.(props.action)}>
      {props.label}
    </button>
  ),
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  Button: ({ props, children, dispatch }) => (
    <button onClick={() => props.action && dispatch?.(props.action)}>
      {children(props.child)}
    </button>
  ),
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  Shortcut: ({ props }) => (
    <kbd title={props.action}>{props.keys}</kbd>
  ),
  // TODO(copilotkit-2.0): This was a v0.9 renderer, which got `{ props, children, dispatch }`. A 2.0 component gets its resolved props directly, child components as slots or `child()` / `childList()` props, and calls an event or a function instead of `dispatch`. Rewrite it, and type its props (`z.output` of its schema): `createGenerativeUI` does not infer them. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#convert-a-custom-catalog
  Metric: ({ props }) => (
    <dl>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </dl>
  ),
};
