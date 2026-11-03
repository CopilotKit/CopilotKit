import { provideCopilotKit } from "@copilotkit/angular";
import type { CopilotKitConfig } from "@copilotkit/angular";
import { environment } from "./environment";

const base: CopilotKitConfig = environment.copilotKit;
const key = environment.runtimeKey;

export const providers = [
  provideCopilotKit({ ...base, headers: { Authorization: "Bearer token" } }),
  provideCopilotKit(base),
  provideCopilotKit({ [key]: environment.url }),
];
