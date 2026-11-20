import {
  dataDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUIChart from "./Chart.vue";

export { CopilotGenerativeUIChart };

/**
 * The standard `Chart` definition: the shared declaration with the Vue
 * component. The data group spreads it into its components:
 *
 * @example
 * ```ts
 * const dataComponents = { ...chartComponent, ...otherDataComponents };
 * ```
 */
export const chartComponent = withComponents(
  { Chart: dataDeclarations.Chart },
  { Chart: CopilotGenerativeUIChart },
);
