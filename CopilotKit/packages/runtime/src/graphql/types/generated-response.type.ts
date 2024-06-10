import { Field, InterfaceType, ObjectType, registerEnumType } from "type-graphql";
import { GenerationInterruption } from "./generation-interruption";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
  function = "function",
}

export enum ActionExecutionScope {
  server = "server",
  client = "client",
}

registerEnumType(MessageRole, {
  name: "MessageRole",
  description: "The role of the message",
});

registerEnumType(ActionExecutionScope, {
  name: "ActionExecutionScope",
  description: "The scope of the action",
});

@ObjectType()
export class MessageStatus {
  constructor({ isDoneStreaming }: { isDoneStreaming: boolean }) {
    this.isDoneStreaming = isDoneStreaming;
  }

  @Field(() => Boolean)
  isDoneStreaming: boolean;
}

@InterfaceType({
  resolveType(value) {
    if (value.hasOwnProperty("content")) {
      return TextMessageOutput;
    } else if (value.hasOwnProperty("name")) {
      return ActionExecutionMessageOutput;
    }
    return undefined;
  },
})
abstract class BaseMessageOutput {
  @Field(() => String)
  id: string;

  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => MessageStatus)
  status: MessageStatus;
}

@ObjectType({ implements: BaseMessageOutput })
export class TextMessageOutput {
  @Field(() => [String])
  content: string[];
}

@ObjectType({ implements: BaseMessageOutput })
export class ActionExecutionMessageOutput {
  @Field(() => String)
  name: string;

  @Field(() => ActionExecutionScope)
  scope: ActionExecutionScope;

  @Field(() => [String])
  arguments: string[];
}

@ObjectType()
export class GeneratedResponse {
  @Field(() => String)
  threadId!: string;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [BaseMessageOutput])
  messages: (typeof BaseMessageOutput)[];

  @Field(() => GenerationInterruption)
  interruption: GenerationInterruption;
}
