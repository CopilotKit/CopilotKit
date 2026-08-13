import { expectTypeOf, test } from "vitest";
import { createChannelCallbackBinding } from "@copilotkit/channels-ui";

import type { TeamsNativeProps } from "./native.js";

test("Teams native event props accept named component callback bindings", () => {
  const binding = createChannelCallbackBinding("approve", { orderId: "42" });
  const props: TeamsNativeProps<{ orderId: string }> = {
    onClick: binding,
    onSelect: binding,
    onSubmit: binding,
  };

  expectTypeOf(props).toMatchTypeOf<TeamsNativeProps<{ orderId: string }>>();
});
