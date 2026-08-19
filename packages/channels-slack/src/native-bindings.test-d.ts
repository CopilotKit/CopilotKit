import { expectTypeOf, test } from "vitest";
import { createChannelCallbackBinding } from "@copilotkit/channels-ui";

import type { SlackNativeProps } from "./native.js";

test("Slack native event props accept named component callback bindings", () => {
  const binding = createChannelCallbackBinding("approve", { orderId: "42" });
  const props: SlackNativeProps<{ orderId: string }> = {
    onClick: binding,
    onSelect: binding,
    onSubmit: binding,
  };

  expectTypeOf(props).toMatchTypeOf<SlackNativeProps<{ orderId: string }>>();
});
