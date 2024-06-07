import { Parameter, Action } from "@copilotkit/shared";
import { RemoteRunnable } from "langchain/runnables/remote";

export interface RemoteChain {
  name: string;
  description: string;
  chainUrl: string;
  parameters?: Parameter[];
  parameterType: "single" | "multi";
}

export class RemoteChainImplementation {
  constructor(public remoteChain: RemoteChain) {
    this.remoteChain = { ...remoteChain };
    this.remoteChain.parameterType ||= "multi";
  }

  async toAction(): Promise<Action<any>> {
    if (!this.remoteChain.parameters) {
      await this.inferLangServeParameters();
    }

    return {
      name: this.remoteChain.name,
      description: this.remoteChain.description,
      parameters: this.remoteChain.parameters!,
      handler: async (args: any) => {
        const runnable = new RemoteRunnable({ url: this.remoteChain.chainUrl });
        let input: any;
        if (this.remoteChain.parameterType === "single") {
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

    let schemaUrl = this.remoteChain.chainUrl.replace(/\/+$/, "") + "/input_schema";
    let schema = await fetch(schemaUrl)
      .then((res) => res.json())
      .catch(() => {
        throw new Error("Failed to fetch langserve schema at " + schemaUrl);
      });
    // for now, don't use json schema, just do a simple conversion

    if (supportedTypes.includes(schema.type)) {
      this.remoteChain.parameterType = "single";
      this.remoteChain.parameters = [
        {
          name: "input",
          type: schema.type,
          description: "The input to the chain",
        },
      ];
    } else if (schema.type === "object") {
      this.remoteChain.parameterType = "multi";
      this.remoteChain.parameters = Object.keys(schema.properties).map((key) => {
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
