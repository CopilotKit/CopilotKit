/**
 * This module provides a function to get a model based on the configuration.
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentState } from "./state";
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
    return new ChatOpenAI({ temperature: 0, model: "gpt-4o" });
  }
  if (model === "anthropic") {
    return new ChatAnthropic({
      temperature: 0,
      modelName: "claude-3-5-sonnet-20240620",
    });
  }
  if (model === "google_genai") {
    return new ChatGoogleGenerativeAI({
      temperature: 0,
      model: "gemini-1.5-pro",
      apiKey: process.env.GOOGLE_API_KEY || undefined,
    });
  }

  throw new Error("Invalid model specified");
}

export { getModel };
