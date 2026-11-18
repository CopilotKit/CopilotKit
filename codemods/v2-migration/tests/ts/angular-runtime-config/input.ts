import { provideCopilotKit } from "@copilotkit/angular";
import { agents } from "./agents";

const licenseKey = "ck_pub_00000000000000000000000000000000";

export const providers = [
  provideCopilotKit({ runtimeUrl: "/api/copilotkit" }),
  provideCopilotKit({ licenseKey }),
  provideCopilotKit({ agents }),
  provideCopilotKit({ "selfManagedAgents": agents }),
];
