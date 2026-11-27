import { useAgentContext } from "@copilotkit/react-core/v2";

import {
  dashboardCompositionContext,
  salesDatasetContext,
} from "../../../../_shared/ts/a2ui/sales-context";

export function useSalesAnalystContext() {
  useAgentContext(salesDatasetContext);
  useAgentContext(dashboardCompositionContext);
}
