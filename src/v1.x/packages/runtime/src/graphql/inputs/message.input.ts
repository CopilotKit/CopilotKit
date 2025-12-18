import { Field, InputType } from "type-graphql";
import { MessageRole } from "../types/enums";
import { BaseMessageInput } from "../types/base";

// GraphQL does not support union types in inputs, so we need to use
// optional fields for the different subtypes.
@InputType()
export class MessageInput extends BaseMessageInput {
  @Field(() => TextMessageInput, { nullable: true })
  textMessage?: TextMessageInput;

  @Field(() => ActionExecutionMessageInput, { nullable: true })
  actionExecutionMessage?: ActionExecutionMessageInput;

  @Field(() => ResultMessageInput, { nullable: true })
  resultMessage?: ResultMessageInput;

  @Field(() => AgentStateMessageInput, { nullable: true })
  agentStateMessage?: AgentStateMessageInput;

  @Field(() => ImageMessageInput, { nullable: true })
  imageMessage?: ImageMessageInput;
}

@InputType()
export class TextMessageInput {
  @Field(() => String)
  content: string;

  @Field(() => String, { nullable: true })
  parentMessageId?: string;

  @Field(() => MessageRole)
  role: MessageRole;
}

@InputType()
export class ActionExecutionMessageInput {
  @Field(() => String)
  name: string;

  @Field(() => String)
  arguments: string;

  @Field(() => String, { nullable: true })
  parentMessageId?: string;

  @Field(() => String, {
    nullable: true,
    deprecationReason: "This field will be removed in a future version",
  })
  scope?: String;
}

@InputType()
export class ResultMessageInput {
  @Field(() => String)
  actionExecutionId: string;

  @Field(() => String)
  actionName: string;

  @Field(() => String, { nullable: true })
  parentMessageId?: string;

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
export class ImageMessageInput {
  @Field(() => String)
  format: string;

  @Field(() => String)
  bytes: string;

  @Field(() => String, { nullable: true })
  parentMessageId?: string;

  @Field(() => MessageRole)
  role: MessageRole;
}
