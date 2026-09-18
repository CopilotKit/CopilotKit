/**
 * This module provides a function to get a model based on the configuration.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentState } from "./state";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

function getModel(state: AgentState): BaseChatModel {
  /**
   * Get a model based on the environment variable.
   */
  const stateModel = state.model;
  const model = process.env.MODEL || stateModel;

  console.log(`Using model: ${model}`);

  if (model === "openai") {
    return new ChatOpenAI({ temperature: 0, model: "gpt-5-mini" });
  }
  if (model === "anthropic") {
    return new ChatAnthropic({
      modelName: "claude-opus-4-8",
    });
  }
  if (model === "google_genai") {
    return new ChatGoogleGenerativeAI({
      temperature: 0,
      model: "gemini-2.5-flash",
      apiKey: process.env.GOOGLE_API_KEY || undefined,
    });
  }

  throw new Error("Invalid model specified");
}

export { getModel };
