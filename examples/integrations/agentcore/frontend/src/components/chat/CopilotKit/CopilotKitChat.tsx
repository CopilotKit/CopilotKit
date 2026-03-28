// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CopilotChat, useDefaultRenderTool } from "@copilotkit/react-core/v2";
import { ToolReasoning } from "./examples/generative-ui/ToolReasoning";

export function CopilotKitChat() {
  useDefaultRenderTool({
    render: ({ name, status, parameters }) => (
      <ToolReasoning name={name} status={status} args={parameters} />
    ),
  });

  return <CopilotChat className="h-full" />;
}
