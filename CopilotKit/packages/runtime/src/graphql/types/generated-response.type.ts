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
      return TextMessage;
    } else if (value.hasOwnProperty("name")) {
      return ActionExecutionMessage;
    }
    return undefined;
  },
})
abstract class BaseMessage {
  @Field(() => String)
  id: string;

  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => MessageStatus)
  status: MessageStatus;
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

// const MessageUnion = createUnionType({
//   name: "MessageUnion",
//   types: () => [TextMessage, ActionExecutionMessage] as const,
//   resolveType: (value) => {
//     // if value has own property content
//     if (value.hasOwnProperty("content")) {
//       return TextMessage;
//     } else if (value.hasOwnProperty("name")) {
//       return ActionExecutionMessage;
//     }

//     return undefined;
//   },
// });

@ObjectType()
export class GeneratedResponse {
  @Field(() => String)
  threadId!: string;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [BaseMessage])
  messages: (typeof BaseMessage)[];

  @Field(() => GenerationInterruption)
  interruption: GenerationInterruption;
}
