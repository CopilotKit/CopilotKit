/**
 * Modal demo — a structured "file a Linear issue" form. Beats parsing free text:
 * the fields come back typed and validated by the platform.
 *
 * Per-platform honesty (the modal vocabulary degrades, it never lies):
 *  - Slack  → the rich form: text inputs + team/priority dropdowns + a type radio.
 *  - Discord→ text-only, ≤5 inputs (discord.js modals take only text inputs), so
 *             the dropdowns/radio drop out and `issueFromValues` applies defaults.
 *  - Telegram→ no modals at all; the `/file-issue` command (Task 5) detects the
 *             missing trigger and falls back to a conversational flow.
 */
import {
  Modal,
  TextInput,
  ModalSelect,
  ModalSelectOption,
  RadioButtons,
} from "@copilotkit/bot-ui";
import type { ModalView } from "@copilotkit/bot-ui";
import type { ModalSubmitHandler } from "@copilotkit/bot";
import { senderContext } from "../sender-context.js";

export const FILE_ISSUE_CALLBACK = "file_issue";

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;

/** Map a modal submission's `values` (keyed by input id) to a typed issue. */
export function issueFromValues(values: Record<string, unknown>) {
  return {
    title: str(values.title),
    description: str(values.description),
    type: str(values.type, "bug"), // absent on Discord text-only → default
    priority: str(values.priority, "Medium"),
  };
}

/**
 * Handle a `/file-issue` modal submission: validate, then file via the agent
 * (Linear MCP) so the existing confirm-before-write + filed-card flow is reused.
 * Returning `{ errors }` keeps the modal open with a field error (Slack); on
 * text-only Discord, `type`/`priority` default in.
 *
 * CRITICAL — Slack's view_submission ack deadline (~3s): the adapter awaits this
 * handler before it can `ack()` the submission, and Slack expects that ack within
 * ~3 seconds. A `runAgent` call (an LLM round-trip + Linear MCP write) routinely
 * exceeds that, so awaiting it here blows the deadline → Slack shows the user a
 * submission error AND retries the submission → the issue gets filed twice.
 * Synchronous validation (the `{ errors }` return) legitimately must run before
 * ack, but the agent run must NOT be awaited on the ack path — so we fire-and-
 * forget it (logging any rejection) and return immediately.
 */
export const fileIssueSubmit: ModalSubmitHandler = async ({
  values,
  thread,
  user,
}) => {
  const issue = issueFromValues(values);
  if (!issue.title.trim()) {
    return { errors: { title: "Give the issue a title." } };
  }
  // No conversation context on the submission → nothing to post into; ack only.
  if (!thread) return;
  // Fire-and-forget: see the deadline note above — do NOT await this.
  void thread
    .runAgent({
      prompt:
        `File a Linear issue now (this was already confirmed via the form):\n` +
        `- Title: ${issue.title}\n- Type: ${issue.type}\n- Priority: ${issue.priority}\n` +
        `- Description: ${issue.description || "(none)"}\n` +
        `After filing, show the issue card.`,
      context: senderContext(user, thread.platform),
    })
    .catch((err) => {
      console.error("[bot] file-issue modal run failed", err);
      void thread
        .post("Sorry — I couldn't file that issue. Please try again.")
        .catch(() => {});
    });
};

/**
 * The form. `rich` controls whether the structured controls (selects/radio) are
 * present; pass `false` on text-only surfaces (Discord).
 */
export function FileIssueModal({ rich }: { rich: boolean }): ModalView {
  return (
    <Modal
      callbackId={FILE_ISSUE_CALLBACK}
      title="File an issue"
      submitLabel="File"
    >
      <TextInput
        id="title"
        label="Title"
        placeholder="Short summary of the issue"
      />
      <TextInput
        id="description"
        label="Description"
        multiline
        optional
        placeholder="What happened? Steps, expected vs actual…"
      />
      {rich ? (
        <ModalSelect id="priority" label="Priority" initialOption="Medium">
          <ModalSelectOption label="Urgent" value="Urgent" />
          <ModalSelectOption label="High" value="High" />
          <ModalSelectOption label="Medium" value="Medium" />
          <ModalSelectOption label="Low" value="Low" />
        </ModalSelect>
      ) : null}
      {rich ? (
        <RadioButtons id="type" label="Type" initialOption="bug">
          <ModalSelectOption label="🐛 Bug" value="bug" />
          <ModalSelectOption label="✨ Feature" value="feature" />
          <ModalSelectOption label="🧹 Chore" value="chore" />
        </RadioButtons>
      ) : null}
    </Modal>
  ) as ModalView;
}
