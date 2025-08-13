import { Field, InputType } from "type-graphql";
import { ActionInputAvailability } from "../types/enums";
@InputType()
export class ActionInput {
  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;

  @Field(() => String)
  jsonSchema: string;

  @Field(() => ActionInputAvailability, { nullable: true })
  available?: ActionInputAvailability;

  /**
   * Route hint: controls which execution context can see this action as a tool.
   * - "model": surface to base LLM adapters (OpenAI, Anthropic, etc.)
   * - "agent": surface to remote agents (LangGraph, etc.)
   * - "local": runtime-only; never surface to model or agent
   */
  @Field(() => String, { nullable: true })
  route?: "model" | "agent" | "local";
}
