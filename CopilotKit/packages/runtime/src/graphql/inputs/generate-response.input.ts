import { Field, InputType } from "type-graphql";
import { MessageInput } from "./message.input";
import { FrontendInput } from "./frontend.input";
import { CloudInput } from "./cloud.input";

@InputType()
export class GenerateResponseInput {
  @Field(() => [MessageInput])
  messages: MessageInput[];

  @Field(() => FrontendInput, { nullable: true })
  frontend?: FrontendInput;

  @Field(() => CloudInput, { nullable: true })
  cloud?: CloudInput;
}

