import { Field, InputType } from "type-graphql";
import { MessageRole } from "../types/generated-response.type";

@InputType()
export class MessageInput {
  @Field(() => String)
  content: string;

  @Field(() => MessageRole)
  role: MessageRole;
}

