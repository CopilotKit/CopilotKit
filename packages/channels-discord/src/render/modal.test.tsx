import { describe, it, expect } from "vitest";
import {
  renderToIR,
  Modal,
  TextInput,
  ModalSelect,
  ModalSelectOption,
  RadioButtons,
} from "@copilotkit/channels-ui";
import type { ChannelNode, ClickHandler } from "@copilotkit/channels-ui";
import { Discord } from "../native.js";
import { renderDiscordModal } from "./modal.js";

describe("renderDiscordModal", () => {
  it("serializes Discord native modal components under the shared Modal root", () => {
    const ir = renderToIR(
      <Modal callbackId="triage" title="Triage">
        <Discord.Modal.TextDisplay content="Tell us what happened." />
        <Discord.Modal.Label label="Summary" description="Keep it short.">
          <Discord.Modal.TextInput
            style={1}
            placeholder="Broken deploy"
            onSubmit={{ id: "ck:summary" } as unknown as ClickHandler}
          />
        </Discord.Modal.Label>
      </Modal>,
    );

    expect(renderDiscordModal(ir).toJSON()).toEqual({
      custom_id: "triage",
      title: "Triage",
      components: [
        { type: 10, content: "Tell us what happened." },
        {
          type: 18,
          label: "Summary",
          description: "Keep it short.",
          component: {
            type: 4,
            custom_id: "ck:summary",
            style: 1,
            placeholder: "Broken deploy",
          },
        },
      ],
    });
  });

  it("serializes every stable Discord modal input type", () => {
    const submit = (id: string) => ({ id }) as unknown as ClickHandler;
    const inputs = [
      <Discord.Modal.TextInput
        key="text"
        style={1}
        onSubmit={submit("ck:text")}
      />,
      <Discord.Modal.StringSelect key="string" onSubmit={submit("ck:string")}>
        <Discord.Object.SelectOption label="Core" value="core" />
      </Discord.Modal.StringSelect>,
      <Discord.Modal.UserSelect key="user" onSubmit={submit("ck:user")} />,
      <Discord.Modal.RoleSelect key="role" onSubmit={submit("ck:role")} />,
      <Discord.Modal.MentionableSelect
        key="mentionable"
        onSubmit={submit("ck:mentionable")}
      />,
      <Discord.Modal.ChannelSelect
        key="channel"
        onSubmit={submit("ck:channel")}
      />,
      <Discord.Modal.FileUpload
        key="file"
        min_values={1}
        max_values={2}
        onSubmit={submit("ck:file")}
      />,
      <Discord.Modal.RadioGroup key="radio" onSubmit={submit("ck:radio")}>
        <Discord.Object.RadioOption label="Fast" value="fast" />
        <Discord.Object.RadioOption label="Safe" value="safe" />
      </Discord.Modal.RadioGroup>,
      <Discord.Modal.CheckboxGroup
        key="checkboxes"
        onSubmit={submit("ck:checkboxes")}
      >
        <Discord.Object.CheckboxOption label="Email me" value="email" />
      </Discord.Modal.CheckboxGroup>,
      <Discord.Modal.Checkbox
        key="checkbox"
        default
        onSubmit={submit("ck:checkbox")}
      />,
    ];

    const types = inputs.map((input, index) => {
      const ir = renderToIR(
        <Modal callbackId={`modal-${index}`} title="Component test">
          <Discord.Modal.Label label={`Field ${index}`}>
            {input}
          </Discord.Modal.Label>
        </Modal>,
      );
      const json = renderDiscordModal(ir).toJSON();
      return (json.components[0] as { component: { type: number } }).component
        .type;
    });

    expect(types).toEqual([4, 3, 5, 6, 7, 8, 19, 21, 22, 23]);
  });

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

  it("renders portable select and radio fields with single-value markers", () => {
    const ir = renderToIR(
      <Modal callbackId="x" title="X">
        <ModalSelect
          id="s"
          label="Service"
          placeholder="Pick one"
          initialOption="api"
        >
          <ModalSelectOption label="API" value="api" />
          <ModalSelectOption label="Web" value="web" />
        </ModalSelect>
        <RadioButtons id="r" label="Mode" initialOption="safe">
          <ModalSelectOption label="Fast" value="fast" />
          <ModalSelectOption label="Safe" value="safe" />
        </RadioButtons>
      </Modal>,
    );

    const json = JSON.parse(JSON.stringify(renderDiscordModal(ir).toJSON()));
    expect(json.components).toEqual([
      {
        type: 18,
        label: "Service",
        component: {
          type: 3,
          custom_id: "ck-portable-single:s",
          placeholder: "Pick one",
          min_values: 1,
          max_values: 1,
          options: [
            { label: "API", value: "api", default: true },
            { label: "Web", value: "web" },
          ],
        },
      },
      {
        type: 18,
        label: "Mode",
        component: {
          type: 21,
          custom_id: "r",
          required: true,
          options: [
            { label: "Fast", value: "fast" },
            { label: "Safe", value: "safe", default: true },
          ],
        },
      },
    ]);
  });

  it("rejects unknown portable modal elements", () => {
    const ir = renderToIR(
      <Modal callbackId="x" title="X">
        <ModalSelect id="s" label="S">
          <ModalSelectOption label="A" value="a" />
        </ModalSelect>
      </Modal>,
    );
    (ir[0]!.props.children as ChannelNode[])[0]!.type = "modal_unknown";
    expect(() => renderDiscordModal(ir)).toThrow(/unsupported modal element/);
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
