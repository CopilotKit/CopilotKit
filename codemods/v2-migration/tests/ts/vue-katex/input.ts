import { useAgent, useKatexStyles } from "@copilotkit/vue";

export function setup() {
  useKatexStyles();
  return useAgent();
}
