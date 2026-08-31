import { describe, it, expect } from "vitest";
import { renderToIR } from "./render.js";
import {
  Modal,
  TextInput,
  ModalSelect,
  ModalSelectOption,
  RadioButtons,
} from "./modal.js";

describe("modal vocabulary", () => {
  it("lowers a modal tree to IR with distinct type tags", () => {
    const view = (
      <Modal callbackId="triage" title="Triage" submitLabel="File">
        <TextInput id="summary" label="Summary" multiline optional />
        <ModalSelect id="prio" label="Priority" initialOption="high">
          <ModalSelectOption label="High" value="high" />
          <ModalSelectOption label="Low" value="low" />
        </ModalSelect>
        <RadioButtons id="team" label="Team">
          <ModalSelectOption label="Core" value="core" />
        </RadioButtons>
      </Modal>
    );
    const [root] = renderToIR(view);
    expect(root!.type).toBe("modal");
    expect(root!.props.callbackId).toBe("triage");
    expect(root!.props.title).toBe("Triage");
    const kids = root!.props.children as {
      type: string;
      props: Record<string, unknown>;
    }[];
    expect(kids.map((k) => k.type)).toEqual([
      "modal_text_input",
      "modal_select",
      "modal_radio",
    ]);
    expect(kids[0]!.props).toMatchObject({
      id: "summary",
      multiline: true,
      optional: true,
    });
    const select = kids[1]!;
    expect(select.props.initialOption).toBe("high");
    const opts = select.props.children as {
      type: string;
      props: Record<string, unknown>;
    }[];
    expect(opts.map((o) => o.props.value)).toEqual(["high", "low"]);
    expect(opts[0]!.type).toBe("modal_select_option");
  });
});
