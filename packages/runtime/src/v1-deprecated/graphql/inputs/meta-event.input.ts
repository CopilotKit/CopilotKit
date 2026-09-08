import { Field, InputType } from "type-graphql";
import { MetaEventName } from "../types/meta-events.type";
import { MessageInput } from "./message.input";

@InputType()
export class MetaEventInput {
  @Field(() => MetaEventName)
  name: MetaEventName;

  @Field(() => String)
  value?: string;

  @Field(() => String, { nullable: true })
  response?: string;

  @Field(() => [MessageInput], { nullable: true })
  messages?: MessageInput[];
}
