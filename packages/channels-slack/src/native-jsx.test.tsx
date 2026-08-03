/** @jsxImportSource @copilotkit/channels-ui */
import { expect, test, vi } from "vitest";
import { renderToIR } from "@copilotkit/channels-ui";
import type { ClickHandler } from "@copilotkit/channels-ui";
import { SlackAdapter } from "./adapter.js";
import { Slack } from "./native.js";
import { serializeSlackNativeNode } from "./native-codec.js";
import { renderBlockKit } from "./render/block-kit.js";

test("native Slack JSX reaches chat.postMessage as Block Kit", async () => {
  const postMessage = vi.fn(async () => ({ ts: "200.5", channel: "C1" }));
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  (adapter as unknown as { client: unknown }).client = {
    chat: { postMessage },
  };

  const ir = renderToIR(
    <Slack.Block.Section
      text={<Slack.Object.MarkdownText text="*Deploy ready*" />}
      accessory={
        <Slack.Element.Button
          key="approve"
          text={<Slack.Object.PlainText text="Approve" />}
          value={{ decision: "approve" }}
          onClick={{ id: "ck:approve" } as unknown as ClickHandler}
        />
      }
    />,
  );

  await adapter.post({ channel: "C1", threadTs: "100.0" }, ir);

  expect(postMessage).toHaveBeenCalledWith({
    channel: "C1",
    thread_ts: "100.0",
    unfurl_links: false,
    unfurl_media: false,
    text: "Deploy ready",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Deploy ready*" },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Approve" },
          value: '{"decision":"approve"}',
          action_id: "ck:approve",
        },
      },
    ],
  });
});

test("native Slack JSX rejects a Teams node before the provider call", async () => {
  const postMessage = vi.fn();
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  (adapter as unknown as { client: unknown }).client = {
    chat: { postMessage },
  };
  const wrongProvider = {
    type: Symbol.for("copilotkit.channels-ui.NativeNode"),
    props: {
      provider: "teams",
      nativeKind: "block",
      nativeType: "TextBlock",
      text: "wrong",
    },
  };

  await expect(
    adapter.post({ channel: "C1" }, [wrongProvider] as never),
  ).rejects.toThrow(/Slack.*Teams|teams.*Slack/i);
  expect(postMessage).not.toHaveBeenCalled();
});

test("native Slack JSX rejects missing required fields with a component path", () => {
  const [button] = renderToIR(<Slack.Element.Button />);

  expect(() => serializeSlackNativeNode(button as never)).toThrow(
    /Slack\.Button\.text.*required/,
  );
});

test("native Slack JSX rejects more than 50 message blocks", () => {
  const ir = renderToIR(
    Array.from({ length: 51 }, (_, index) => (
      <Slack.Block.Divider key={`divider-${index}`} />
    )),
  );

  expect(() => renderBlockKit(ir)).toThrow(/51.*50|50.*51/);
});
