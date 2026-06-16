/**
 * Copilot Runtime adapter for Docker Model Runner.
 *
 * Docker Model Runner exposes an OpenAI-compatible API for locally running
 * AI models via Docker Desktop. See https://docs.docker.com/ai/model-runner/
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, DockerModelRunnerAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new DockerModelRunnerAdapter({ model: "ai/llama3.2" });
 * ```
 *
 * ## Example with custom base URL
 *
 * ```ts
 * import { CopilotRuntime, DockerModelRunnerAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new DockerModelRunnerAdapter({
 *   model: "ai/mistral",
 *   baseUrl: "http://model-runner.docker.internal/engines/llama.cpp/v1",
 * });
 * ```
 */
import Openai from "openai";
import { OpenAIAdapter } from "../openai/openai-adapter";
import type { OpenAIAdapterParams } from "../openai/openai-adapter";

const DEFAULT_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
const DEFAULT_MODEL = "ai/llama3.2";

export interface DockerModelRunnerAdapterParams extends Omit<
  OpenAIAdapterParams,
  "openai"
> {
  /**
   * The base URL of the Docker Model Runner API endpoint.
   * Defaults to `http://localhost:12434/engines/llama.cpp/v1`.
   * Can also be set via the `DOCKER_MODEL_RUNNER_BASE_URL` environment variable.
   */
  baseUrl?: string;
}

export class DockerModelRunnerAdapter extends OpenAIAdapter {
  public override get name() {
    return "DockerModelRunnerAdapter";
  }

  constructor(params?: DockerModelRunnerAdapterParams) {
    const baseUrl =
      params?.baseUrl ??
      process.env["DOCKER_MODEL_RUNNER_BASE_URL"] ??
      DEFAULT_BASE_URL;

    const openai = new Openai({
      baseURL: baseUrl,
      apiKey: "docker",
    });

    super({
      ...params,
      openai,
      model: params?.model ?? DEFAULT_MODEL,
    });
  }
}
