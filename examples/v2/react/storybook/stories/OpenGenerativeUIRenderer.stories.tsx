import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  OpenGenerativeUIActivityRenderer,
  OpenGenerativeUIActivityType,
  OpenGenerativeUIToolRenderer,
  ToolCallStatus,
} from "@copilotkit/react-core/v2";
import type { OpenGenerativeUIContent } from "@copilotkit/react-core/v2";
import { withMessageColumn } from "./support/layouts";

/**
 * Open Generative UI: the agent streams HTML/CSS for a one-off interface and
 * `OpenGenerativeUIActivityRenderer` runs it in a sandboxed iframe, sizing the
 * frame to the content once generation finishes. The content below is fixture
 * data in the shape the agent streams, so rendering is fully offline.
 * `OpenGenerativeUIToolRenderer` shows the agent's placeholder messages while
 * the UI is being generated.
 */
const css = `
  body { margin: 0; font: 14px/1.45 system-ui, sans-serif; color: #18181b; }
  .card { border: 1px solid #e4e4e7; border-radius: 14px; padding: 16px; background: #fff; }
  h2 { margin: 0 0 4px; font-size: 15px; }
  p { margin: 0 0 12px; color: #71717a; font-size: 13px; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #f4f4f5; }
  .bar { flex: 1; height: 8px; border-radius: 99px; background: #f4f4f5; overflow: hidden; }
  .bar span { display: block; height: 100%; background: #18181b; border-radius: 99px; }
  .label { width: 110px; font-size: 13px; }
  .value { width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }
`;

const html = [
  `<div class="card"><h2>Launch readiness</h2><p>Share of checklist items complete per team.</p>`,
  `<div class="row"><span class="label">Engineering</span><div class="bar"><span style="width:92%"></span></div><span class="value">92%</span></div>`,
  `<div class="row"><span class="label">Design</span><div class="bar"><span style="width:100%"></span></div><span class="value">100%</span></div>`,
  `<div class="row"><span class="label">Marketing</span><div class="bar"><span style="width:64%"></span></div><span class="value">64%</span></div>`,
  `<div class="row"><span class="label">Support</span><div class="bar"><span style="width:48%"></span></div><span class="value">48%</span></div></div>`,
];

const complete: OpenGenerativeUIContent = {
  initialHeight: 220,
  generating: false,
  css,
  cssComplete: true,
  html,
  htmlComplete: true,
};

const meta = {
  title: "UI/OpenGenerativeUIRenderer",
  component: OpenGenerativeUIActivityRenderer,
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    activityType: OpenGenerativeUIActivityType,
    content: complete,
    message: undefined,
    agent: undefined,
  },
} satisfies Meta<typeof OpenGenerativeUIActivityRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Generation finished: the sandbox is sized to its content. */
export const Complete: Story = {};

/** Styles are still streaming: the placeholder with a spinner. */
export const Generating: Story = {
  args: {
    content: { initialHeight: 220, generating: true, css: "body {" },
  },
};

/** Styles are in and HTML is streaming: a live preview under the spinner. */
export const StreamingPreview: Story = {
  args: {
    content: {
      initialHeight: 220,
      generating: true,
      css,
      cssComplete: true,
      html: html.slice(0, 3),
    },
  },
};

/** The tool renderer's placeholder message while the agent generates. */
export const ToolPlaceholder: Story = {
  render: () => (
    <OpenGenerativeUIToolRenderer
      name="generateSandboxedUi"
      args={{
        placeholderMessages: [
          "Sketching a readiness dashboard…",
          "Adding a bar per team…",
        ],
      }}
      status={ToolCallStatus.InProgress}
      result={undefined}
    />
  ),
};
