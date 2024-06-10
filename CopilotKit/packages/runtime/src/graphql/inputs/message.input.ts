import { Field, InputType, registerEnumType } from "type-graphql";
import { MessageRole } from "../types/generated-response.type";

// GraphQL does not support union types in inputs, so we need to use
// optional fields for the different subtypes.

export enum MessageInputType {
  text = "text",
}

registerEnumType(MessageInputType, {
  name: "MessageInputType",
});

@InputType()
export class MessageInput {
  @Field(() => String)
  id: string;

  @Field(() => MessageRole)
  role: MessageRole;

  @Field(() => MessageInputType)
  type: MessageInputType;

  @Field(() => TextMessageInput, { nullable: true })
  textMessage?: TextMessageInput;
}

@InputType()
export class TextMessageInput {
  @Field(() => String)
  content: string;
}
