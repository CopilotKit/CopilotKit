import { Field, InputType } from "type-graphql";
import { MessageRole, ActionExecutionScope } from "../types/enums";
import { BaseMessage } from "../types/base";

@InputType()
export class MessageInput extends BaseMessage {
  @Field(() => TextMessageInput, { nullable: true })
  textMessage?: TextMessageInput;

  @Field(() => ActionExecutionMessageInput, { nullable: true })
  actionExecutionMessage?: ActionExecutionMessageInput;

  @Field(() => ResultMessageInput, { nullable: true })
  resultMessage?: ResultMessageInput;

  @Field(() => AgentStateMessageInput, { nullable: true })
  agentStateMessage?: AgentStateMessageInput;

  @Field(() => ContentMessageInput, { nullable: true })
  contentMessage?: ContentMessageInput;
}

@InputType()
export class MessageContentInput {
  @Field(() => String)
  type: "text" | "image_url";

  @Field(() => TextContentBlockInput, { nullable: true })
  textContent?: TextContentBlockInput;

  @Field(() => ImageURLContentBlockInput, { nullable: true })
  imageURLContent?: ImageURLContentBlockInput;
}

@InputType()
export class ContentMessageInput {
  @Field(() => [MessageContentInput])
  content: MessageContentInput[];

  @Field(() => MessageRole)
  role: MessageRole;
}

@InputType()
export class TextMessageInput {
  @Field(() => String)
  content: string;

  @Field(() => MessageRole)
  role: MessageRole;
}

@InputType()
export class ActionExecutionMessageInput {
  @Field(() => String)
  name: string;

  @Field(() => String)
  arguments: string;

  @Field(() => ActionExecutionScope)
  scope: ActionExecutionScope;
}

@InputType()
export class ResultMessageInput {
  @Field(() => String)
  actionExecutionId: string;

  @Field(() => String)
  actionName: string;

  @Field(() => String)
  result: string;
}

@InputType()
export class AgentStateMessageInput {
  @Field(() => String)
  threadId: string;

  @Field(() => String)
  agentName: string;

  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => String)
  state: string;

  @Field(() => Boolean)
  running: boolean;

  @Field(() => String)
  nodeName: string;

  @Field(() => String)
  runId: string;

  @Field(() => Boolean)
  active: boolean;
}

@InputType()
export class ImageURLContentBlockInput {
  @Field(() => String)
  type: "image_url";

  @Field(() => ImageURLInput)
  image_url: ImageURLInput;
}

@InputType()
export class ImageURLInput {
  @Field(() => String)
  url: string;

  @Field(() => String, { nullable: true, defaultValue: "auto" })
  detail?: "auto" | "low" | "high";
}

@InputType()
export class TextContentBlockInput {
  @Field(() => String)
  type: "text";

  @Field(() => String)
  text: string;
}