import { describe, it, expect } from "vitest";
import {
  renderToIR,
  ModalRenderError,
  Modal,
  TextInput,
  ModalSelect,
  ModalSelectOption,
} from "@copilotkit/channels-ui";
import { renderDiscordModal } from "./modal.js";

describe("renderDiscordModal", () => {
  it("builds a modal of text inputs", () => {
    const ir = renderToIR(
      <Modal callbackId="triage" title="Triage">
        <TextInput id="summary" label="Summary" multiline />
        <TextInput id="detail" label="Detail" optional />
      </Modal>,
    );
    const modal = renderDiscordModal(ir);
    const json = modal.toJSON();
    expect(json.custom_id).toBe("triage");
    expect(json.title).toBe("Triage");
    expect(json.components).toHaveLength(2);
  });

  it("rejects non-text-input elements", () => {
    const ir = renderToIR(
      <Modal callbackId="x" title="X">
        <ModalSelect id="s" label="S">
          <ModalSelectOption label="A" value="a" />
        </ModalSelect>
      </Modal>,
    );
    expect(() => renderDiscordModal(ir)).toThrow(ModalRenderError);
  });

  it("rejects more than five text inputs", () => {
    const ir = renderToIR(
      <Modal callbackId="x" title="X">
        {Array.from({ length: 6 }, (_, n) => (
          <TextInput key={n} id={`f${n}`} label={`F${n}`} />
        ))}
      </Modal>,
    );
    expect(() => renderDiscordModal(ir)).toThrow(/at most 5/i);
  });
});
