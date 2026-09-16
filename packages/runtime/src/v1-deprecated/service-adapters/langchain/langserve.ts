/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — RemoteChain:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — RemoteChainParameters:
 *   No 1:1 v2 replacement is available.
 *   Related v2 docs (Runtime server adapter): https://docs.copilotkit.ai/runtime-server-adapter
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import type { Parameter, Action } from "@copilotkit/shared";

export interface RemoteChainParameters {
  name: string;
  description: string;
  chainUrl: string;
  parameters?: Parameter[];
  parameterType?: "single" | "multi";
}

export class RemoteChain {
  name: string;
  description: string;
  chainUrl: string;
  parameters?: Parameter[];
  parameterType: "single" | "multi";

  constructor(options: RemoteChainParameters) {
    this.name = options.name;
    this.description = options.description;
    this.chainUrl = options.chainUrl;
    this.parameters = options.parameters;
    this.parameterType = options.parameterType || "multi";
  }

  async toAction(): Promise<Action<any>> {
    if (!this.parameters) {
      await this.inferLangServeParameters();
    }

    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters!,
      handler: async (args: any) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { RemoteRunnable } = require("langchain/runnables/remote");
        const runnable = new RemoteRunnable({ url: this.chainUrl });
        let input: any;
        if (this.parameterType === "single") {
          input = args[Object.keys(args)[0]];
        } else {
          input = args;
        }
        return await runnable.invoke(input);
      },
    };
  }

  async inferLangServeParameters() {
    const supportedTypes = ["string", "number", "boolean"];

    let schemaUrl = this.chainUrl.replace(/\/+$/, "") + "/input_schema";
    let schema = await fetch(schemaUrl)
      .then((res) => res.json())
      .catch(() => {
        throw new Error("Failed to fetch langserve schema at " + schemaUrl);
      });
    // for now, don't use json schema, just do a simple conversion

    if (supportedTypes.includes(schema.type)) {
      this.parameterType = "single";
      this.parameters = [
        {
          name: "input",
          type: schema.type,
          description: "The input to the chain",
        },
      ];
    } else if (schema.type === "object") {
      this.parameterType = "multi";
      this.parameters = Object.keys(schema.properties).map((key) => {
        let property = schema.properties[key];
        if (!supportedTypes.includes(property.type)) {
          throw new Error("Unsupported schema type");
        }
        return {
          name: key,
          type: property.type,
          description: property.description || "",
          required: schema.required?.includes(key) || false,
        };
      });
    } else {
      throw new Error("Unsupported schema type");
    }
  }
}
