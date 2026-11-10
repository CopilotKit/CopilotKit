// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import {
  ChannelUi,
  sendChannelInteraction,
  useChannelUi,
} from "../react/index.js";
import type { WebUiNode } from "../wire.js";
import { ScriptedAgent } from "./helpers.js";

afterEach(cleanup);

const t = (value: string): WebUiNode => ({ type: "text", props: { value } });

const card: WebUiNode[] = [
  {
    type: "message",
    props: {
      children: [
        { type: "header", props: { children: [t("Deploy")] } },
        { type: "section", props: { children: [t("Ship build 42?")] } },
        {
          type: "fields",
          props: {
            children: [
              { type: "field", props: { label: "Env", children: [t("prod")] } },
            ],
          },
        },
        {
          type: "actions",
          props: {
            children: [
              {
                type: "button",
                props: {
                  onClick: "ck:yes",
                  value: "yes",
                  children: [t("Approve")],
                },
              },
              {
                type: "button",
                props: {
                  url: "javascript:alert(1)",
                  children: [t("Bad link")],
                },
              },
              {
                type: "button",
                props: {
                  url: "https://example.com/docs",
                  children: [t("Docs")],
                },
              },
            ],
          },
        },
        {
          type: "image",
          props: {
            url: "https://example.com/chart.png",
            alt: "Error rate chart",
          },
        },
        { type: "divider", props: {} },
        {
          type: "table",
          props: {
            columns: [{ header: "Service" }, { header: "Status" }],
            children: [
              {
                type: "row",
                props: {
                  children: [
                    { type: "cell", props: { children: [t("api")] } },
                    { type: "cell", props: { children: [t("ok")] } },
                  ],
                },
              },
            ],
          },
        },
        { type: "mystery", props: { children: [t("kept text")] } },
        { type: "mystery", props: {} },
      ],
    },
  },
];

describe("<ChannelUi>", () => {
  it("renders the IR as semantic HTML", () => {
    const { container } = render(<ChannelUi ir={card} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "Deploy" }),
    ).toBeTruthy();
    expect(screen.getByText("Ship build 42?")).toBeTruthy();
    expect(screen.getByRole("list").textContent).toBe("Env prod");
    expect(screen.getByRole("img", { name: "Error rate chart" })).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Service", "Status"]);
    expect(screen.getByRole("cell", { name: "api" })).toBeTruthy();
    expect(screen.getByText("kept text")).toBeTruthy();
    expect(
      container.querySelector('[data-channels-ui="message"]'),
    ).toBeTruthy();
  });

  it("renders safe links and drops unsafe ones", () => {
    render(<ChannelUi ir={card} />);
    expect(
      screen.getByRole("link", { name: "Docs" }).getAttribute("href"),
    ).toBe("https://example.com/docs");
    expect(screen.queryByRole("link", { name: "Bad link" })).toBeNull();
  });

  it("sends a button click with its id, value, and message id", () => {
    const onAction = vi.fn();
    render(<ChannelUi ir={card} messageId="m1" onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onAction).toHaveBeenCalledWith({
      id: "ck:yes",
      value: "yes",
      messageId: "m1",
    });
  });

  it("disables controls without a handler or when disabled", () => {
    const { rerender } = render(<ChannelUi ir={card} />);
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    rerender(<ChannelUi ir={card} onAction={() => {}} disabled />);
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("sends a select choice through a labelled select and a submit button", () => {
    const onAction = vi.fn();
    render(
      <ChannelUi
        ir={[
          {
            type: "select",
            props: {
              onSelect: "ck:size",
              name: "size",
              placeholder: "Pick a size",
              options: [
                { label: "Small", value: "s" },
                { label: "Large", value: "l" },
              ],
            },
          },
        ]}
        onAction={onAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Pick a size"), {
      target: { value: "l" },
    });
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith({
      id: "ck:size",
      value: "l",
      values: { size: "l" },
    });
  });

  it("sends entered text from a labelled input", () => {
    const onAction = vi.fn();
    render(
      <ChannelUi
        ir={[
          {
            type: "input",
            props: { onSubmit: "ck:note", placeholder: "Add a note" },
          },
        ]}
        onAction={onAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "looks good" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAction).toHaveBeenCalledWith({
      id: "ck:note",
      value: "looks good",
    });
  });

  it("uses renderMarkdown for markdown nodes", () => {
    render(
      <ChannelUi
        ir={[{ type: "markdown", props: { children: [t("**bold**")] } }]}
        renderMarkdown={(text) => <em>{text.replaceAll("*", "")}</em>}
      />,
    );
    expect(screen.getByText("bold").tagName).toBe("EM");
  });
});

describe("useChannelUi", () => {
  const ui = (messageId: string, label: string): BaseEvent =>
    ({
      type: EventType.CUSTOM,
      name: "channels.ui",
      value: { messageId, ir: [t(label)] },
    }) as BaseEvent;

  it("tracks set, replace, and delete events per message id", async () => {
    const agent = new ScriptedAgent([
      () => [ui("m1", "first"), ui("m2", "other")],
      () => [
        ui("m1", "replaced"),
        {
          type: EventType.CUSTOM,
          name: "channels.ui.delete",
          value: { messageId: "m2" },
        } as BaseEvent,
      ],
    ]);
    const { result } = renderHook(() => useChannelUi(agent));

    await act(() => agent.runAgent());
    expect(result.current.get("m1")).toEqual([t("first")]);
    expect(result.current.get("m2")).toEqual([t("other")]);

    await act(() => agent.runAgent());
    expect(result.current.get("m1")).toEqual([t("replaced")]);
    expect(result.current.has("m2")).toBe(false);
  });

  it("keeps the agent's text messages in sync with updated and deleted UI", async () => {
    const say = (messageId: string, text: string): BaseEvent[] =>
      [
        { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
        { type: EventType.TEXT_MESSAGE_END, messageId },
      ] as BaseEvent[];
    const uiWithText = (messageId: string, text: string): BaseEvent =>
      ({
        type: EventType.CUSTOM,
        name: "channels.ui",
        value: { messageId, ir: [t(text)], text },
      }) as BaseEvent;
    const agent = new ScriptedAgent([
      () => [
        ...say("m1", "Deploy?"),
        uiWithText("m1", "Deploy?"),
        ...say("m2", "Pick a region"),
        uiWithText("m2", "Pick a region"),
      ],
      () => [
        uiWithText("m1", "Deployed."),
        {
          type: EventType.CUSTOM,
          name: "channels.ui.delete",
          value: { messageId: "m2" },
        } as BaseEvent,
      ],
    ]);
    renderHook(() => useChannelUi(agent));

    await act(() => agent.runAgent());
    expect(agent.messages.map((m) => [m.id, m.content])).toEqual([
      ["m1", "Deploy?"],
      ["m2", "Pick a region"],
    ]);

    await act(() => agent.runAgent());
    // The history the client sends next matches what the user sees.
    expect(agent.messages.map((m) => [m.id, m.content])).toEqual([
      ["m1", "Deployed."],
    ]);
  });

  it("sends a click as forwardedProps.channelInteraction", async () => {
    const agent = new ScriptedAgent([() => []]);
    await sendChannelInteraction(agent, {
      id: "ck:1",
      value: 2,
      messageId: "m",
    });
    expect(agent.inputs[0]?.forwardedProps).toEqual({
      channelInteraction: { id: "ck:1", value: 2, messageId: "m" },
    });
  });
});
