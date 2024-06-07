import { Field, ObjectType, registerEnumType } from "type-graphql";
import { GenerationInterruption } from "./generation-interruption";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
  function = "function",
}

registerEnumType(MessageRole, {
  name: "MessageRole",
  description: "The role of the message",
});

@ObjectType()
export class Message {
  @Field(() => String)
  id: string;

  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => [String])
  content: string[];

  @Field(() => Boolean)
  isStream: boolean;
}

@ObjectType()
export class GeneratedResponse {
  @Field(() => String)
  threadId!: string;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [Message])
  messages: Message[];

  @Field(() => GenerationInterruption)
  interruption: GenerationInterruption;
}
