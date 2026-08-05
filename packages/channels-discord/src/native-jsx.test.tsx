/** @jsxImportSource @copilotkit/channels-ui */
import { expect, test } from "vitest";
import { isNativeNode, renderToIR } from "@copilotkit/channels-ui";
import { Discord } from "./index.js";

test("Discord message JSX keeps its provider and native component identity", () => {
  const [container] = renderToIR(
    <Discord.Message.Container accent_color={0x5865f2}>
      <Discord.Message.TextDisplay content="Deploy ready" />
    </Discord.Message.Container>,
  );

  expect(isNativeNode(container)).toBe(true);
  expect(container).toMatchObject({
    props: {
      provider: "discord",
      nativeKind: "layout",
      nativeType: "container",
      accent_color: 0x5865f2,
      children: {
        props: {
          provider: "discord",
          nativeKind: "element",
          nativeType: "text_display",
          content: "Deploy ready",
        },
      },
    },
  });
});
