import { describe, it, expect } from "vitest";
import {
  renderToIR,
  Modal,
  TextInput,
  ModalSelect,
  ModalSelectOption,
  RadioButtons,
} from "@copilotkit/channels-ui";
import { renderSlackModal } from "./modal.js";

describe("renderSlackModal", () => {
  it("builds a Slack modal view from a modal IR", () => {
    const ir = renderToIR(
      <Modal
        callbackId="triage"
        title="Triage"
        submitLabel="File"
        privateMetadata="meta"
      >
        <TextInput
          id="summary"
          label="Summary"
          multiline
          optional
          initialValue="x"
          maxLength={200}
        />
        <ModalSelect id="prio" label="Priority" initialOption="high">
          <ModalSelectOption label="High" value="high" />
        </ModalSelect>
        <RadioButtons id="team" label="Team">
          <ModalSelectOption label="Core" value="core" />
        </RadioButtons>
      </Modal>,
    );
    const view = renderSlackModal(ir);
    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("triage");
    expect(view.private_metadata).toBe("meta");
    expect(view.title).toEqual({ type: "plain_text", text: "Triage" });
    expect(view.submit).toEqual({ type: "plain_text", text: "File" });
    const [text, select, radio] = view.blocks as unknown as Record<
      string,
      unknown
    >[];
    expect(text).toMatchObject({
      type: "input",
      block_id: "summary",
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "summary",
        multiline: true,
        initial_value: "x",
        max_length: 200,
      },
    });
    expect(select!.element).toMatchObject({
      type: "static_select",
      action_id: "prio",
    });
    expect(radio!.element).toMatchObject({
      type: "radio_buttons",
      action_id: "team",
    });
  });

  it('defaults the submit label to "Submit"', () => {
    const ir = renderToIR(
      <Modal callbackId="x" title="X">
        <TextInput id="f" label="F" />
      </Modal>,
    );
    const view = renderSlackModal(ir);
    expect(view.submit).toEqual({ type: "plain_text", text: "Submit" });
  });

  it("throws ModalRenderError when there is no modal root", () => {
    expect(() => renderSlackModal([])).toThrow(/no <Modal> root/);
  });
});
