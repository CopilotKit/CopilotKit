/**
 * <ArgFormDemo /> — visual-verification harness for M4.
 *
 * Hand-authored `ParameterDescriptor[]` fixtures that mirror the M1 schema
 * extractor's expected output for representative real-world tools:
 *
 *   - showCar           — v1 nested-object schema (`useCopilotAction`)
 *   - sayHello          — v2 Zod single-string schema
 *   - schedule_meeting  — v2 with optional / array / enum / nested object / boolean
 *
 * Plus a "kitchen sink" descriptor that hits every ParameterDescriptor.type
 * variant (string, number, boolean, enum, array of strings, nested object,
 * opaque) in one form.
 *
 * The demo is NOT wired into the main `App.tsx` (that's M7's job). To render
 * it standalone, swap `main.tsx`'s import to point at this file and run
 * `pnpm run dev:spa` — the form mounts and editing any control prints the
 * full aggregated args object to the page (and to the console).
 *
 * Use it as the visual smoke test for M4. After M7 wires the real selection
 * pipeline, this file can either stay as a regression demo or be folded into
 * a Storybook story.
 */
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { ParameterDescriptor } from "../../shared/types.js";

import { ArgForm } from "./arg-form.js";
import { descriptorToDefaults } from "../lib/descriptor-to-form.js";

// ---------------------------------------------------------------------------
// Hand-authored ParameterDescriptor[] fixtures
// ---------------------------------------------------------------------------

/** v1 `useCopilotAction({ parameters: [...] })` — nested object. */
export const SHOW_CAR_DESCRIPTORS: ParameterDescriptor[] = [
  {
    name: "car",
    type: "object",
    required: true,
    description: "The car to show in the chat as a card.",
    properties: [
      {
        name: "year",
        type: "number",
        required: true,
        description: "Model year",
      },
      {
        name: "make",
        type: "string",
        required: true,
        description: "e.g. Toyota",
      },
      {
        name: "model",
        type: "string",
        required: true,
        description: "e.g. Camry",
      },
      {
        name: "color",
        type: "string",
        required: false,
        description: "Optional exterior color",
      },
      {
        name: "price",
        type: "number",
        required: false,
        description: "USD",
      },
    ],
  },
];

/** v2 `useRenderTool({ parameters: z.object({ name: z.string() }) })`. */
export const SAY_HELLO_DESCRIPTORS: ParameterDescriptor[] = [
  {
    name: "name",
    type: "string",
    required: true,
    description: "The person to greet.",
  },
];

/**
 * v2 `schedule_meeting` — exercises every interesting shape in one descriptor:
 *   - required string + optional string
 *   - enum on `duration`
 *   - boolean on `sendInvites`
 *   - array of strings on `attendees`
 *   - nested object on `location` (with its own optional fields)
 */
export const SCHEDULE_MEETING_DESCRIPTORS: ParameterDescriptor[] = [
  {
    name: "title",
    type: "string",
    required: true,
    description: "The meeting title shown on the calendar invite.",
  },
  {
    name: "duration",
    type: "enum",
    required: true,
    description: "How long to block on the calendar.",
    enumValues: ["15min", "30min", "45min", "60min", "90min"],
  },
  {
    name: "attendees",
    type: "array",
    required: true,
    description: "Email addresses of every required attendee.",
    itemType: {
      name: "email",
      type: "string",
      required: true,
      description: "Email address",
    },
  },
  {
    name: "agenda",
    type: "string",
    required: false,
    description: "Optional pre-read sent to attendees.",
  },
  {
    name: "sendInvites",
    type: "boolean",
    required: true,
    description: "Whether the calendar should fire invite emails on save.",
  },
  {
    name: "location",
    type: "object",
    required: false,
    description: "Where to hold the meeting. Omit for an unspecified location.",
    properties: [
      {
        name: "kind",
        type: "enum",
        required: true,
        enumValues: ["in-person", "video", "phone"],
      },
      {
        name: "details",
        type: "string",
        required: false,
        description:
          "Room name for in-person, link for video, phone number for phone.",
      },
    ],
  },
];

/** Kitchen sink — touches every type variant in one form. */
export const KITCHEN_SINK_DESCRIPTORS: ParameterDescriptor[] = [
  {
    name: "label",
    type: "string",
    required: true,
    description: "A free-text label",
  },
  { name: "count", type: "number", required: true, description: "How many" },
  { name: "active", type: "boolean", required: false, description: "Toggle" },
  {
    name: "color",
    type: "enum",
    required: true,
    enumValues: ["red", "green", "blue"],
    description: "Pick a color",
  },
  {
    name: "tags",
    type: "array",
    required: false,
    description: "Free-form tags",
    itemType: { name: "tag", type: "string", required: true },
  },
  {
    name: "address",
    type: "object",
    required: false,
    description: "Optional shipping address",
    properties: [
      { name: "street", type: "string", required: true },
      { name: "city", type: "string", required: true },
      { name: "zip", type: "string", required: false },
    ],
  },
  {
    name: "metadata",
    type: "opaque",
    required: false,
    description: "Arbitrary JSON we couldn't statically infer.",
  },
];

// ---------------------------------------------------------------------------
// Single-sample preview cell
// ---------------------------------------------------------------------------

function SamplePreview({
  title,
  caption,
  parameters,
}: {
  title: string;
  caption: string;
  parameters: ParameterDescriptor[];
}): ReactElement {
  const [value, setValue] = useState<unknown>(() =>
    descriptorToDefaults(parameters),
  );

  return (
    <section style={styles.sample}>
      <header style={styles.sampleHeader}>
        <h2 style={styles.sampleTitle}>{title}</h2>
        <p style={styles.sampleCaption}>{caption}</p>
      </header>

      <div style={styles.sampleBody}>
        <div style={styles.sampleForm}>
          <ArgForm
            parameters={parameters}
            value={value}
            onChange={(next) => {
              setValue(next);
              // Mirror to console so visual verification can correlate field
              // edits with the aggregated payload. Intentional log.
              // eslint-disable-next-line no-console
              console.log(`[arg-form.demo] ${title} →`, next);
            }}
          />
          <button
            type="button"
            style={styles.resetButton}
            onClick={() => setValue(descriptorToDefaults(parameters))}
          >
            Reset to defaults
          </button>
        </div>

        <pre style={styles.samplePre}>{safeStringify(value)}</pre>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-level demo
// ---------------------------------------------------------------------------

/**
 * Mount this component anywhere (or swap `main.tsx`'s import) to visually
 * smoke-test every M4 control path.
 */
export function ArgFormDemo(): ReactElement {
  return (
    <div style={styles.page}>
      <header style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>CopilotKit Studio — M4 ArgForm demo</h1>
        <p style={styles.pageSubtitle}>
          Hand-authored <code>ParameterDescriptor[]</code> samples covering
          every form-control path. Editing any field updates the live JSON on
          the right; full payload also logs to the console.
        </p>
      </header>

      <main style={styles.grid}>
        <SamplePreview
          title="showCar (v1, nested object)"
          caption="useCopilotAction with nested-object parameters"
          parameters={SHOW_CAR_DESCRIPTORS}
        />
        <SamplePreview
          title="sayHello (v2 Zod, string)"
          caption="useRenderTool with z.object({ name: z.string() })"
          parameters={SAY_HELLO_DESCRIPTORS}
        />
        <SamplePreview
          title="schedule_meeting (v2, mixed)"
          caption="optional fields, array, enum, nested object, boolean"
          parameters={SCHEDULE_MEETING_DESCRIPTORS}
        />
        <SamplePreview
          title="kitchen sink (every type)"
          caption="string, number, boolean, enum, array<string>, object, opaque"
          parameters={KITCHEN_SINK_DESCRIPTORS}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `// JSON.stringify failed: ${message}`;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  page: {
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#111",
    padding: "1.5rem 2rem",
    maxWidth: 1400,
    margin: "0 auto",
  },
  pageHeader: {
    marginBottom: "1.5rem",
  },
  pageTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    margin: "0 0 0.25rem",
  },
  pageSubtitle: {
    margin: 0,
    color: "#555",
    fontSize: 13.5,
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))",
    gap: "1.5rem",
  },
  sample: {
    border: "1px solid #e4e4e7",
    borderRadius: 6,
    backgroundColor: "#fff",
    padding: "1rem 1.25rem 1.25rem",
  },
  sampleHeader: {
    paddingBottom: "0.75rem",
    borderBottom: "1px solid #f0f0f3",
    marginBottom: "1rem",
  },
  sampleTitle: {
    margin: "0 0 0.125rem",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  sampleCaption: {
    margin: 0,
    fontSize: 12,
    color: "#666",
  },
  sampleBody: {
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr",
    gap: "1rem",
    alignItems: "start",
  },
  sampleForm: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  samplePre: {
    margin: 0,
    padding: "0.75rem 0.875rem",
    background: "#0f172a",
    color: "#e2e8f0",
    fontSize: 11.5,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    borderRadius: 4,
    overflow: "auto",
    maxHeight: 380,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  resetButton: {
    alignSelf: "flex-start",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11.5,
    padding: "0.25rem 0.625rem",
    background: "transparent",
    color: "#444",
    border: "1px solid #d4d4d8",
    borderRadius: 4,
    cursor: "pointer",
  },
};
