import { Field, InterfaceType, ObjectType, createUnionType, registerEnumType } from "type-graphql";
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

@InterfaceType()
abstract class BaseMessage {
  @Field(() => String)
  id: string;

  @Field(() => MessageRole)
  role: MessageRole;
}

@ObjectType({ implements: BaseMessage })
export class TextMessage {
  @Field(() => [String])
  content: string[];
}

@ObjectType({ implements: BaseMessage })
export class ActionExecutionMessage {
  @Field(() => String)
  name: string;

  @Field(() => ActionExecutionScope)
  scope: ActionExecutionScope;

  @Field(() => [String])
  arguments: string[];
}

const MessageUnion = createUnionType({
  name: "MessageUnion",
  types: () => [TextMessage, ActionExecutionMessage] as const,
  resolveType: (value) => {
    // if value has own property content
    if (value.hasOwnProperty("content")) {
      return TextMessage;
    } else if (value.hasOwnProperty("name")) {
      return ActionExecutionMessage;
    }

    return undefined;
  },
});

@ObjectType()
export class GeneratedResponse {
  @Field(() => String)
  threadId!: string;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [MessageUnion])
  messages: (typeof MessageUnion)[];

  @Field(() => GenerationInterruption)
  interruption: GenerationInterruption;
}
