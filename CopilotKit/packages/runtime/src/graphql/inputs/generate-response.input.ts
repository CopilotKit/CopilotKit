import { Field, InputType } from "type-graphql";
import { MessageInput } from "./message.input";
import { FrontendInput } from "./frontend.input";
import { CloudInput } from "./cloud.input";

@InputType()
export class GenerateResponseInput {
  @Field({ nullable: true })
  threadId?: string;

  @Field({ nullable: true })
  runId?: string;

  @Field(() => [MessageInput])
  messages: MessageInput[];

  @Field(() => FrontendInput)
  frontend: FrontendInput;

  @Field(() => CloudInput, { nullable: true })
  cloud?: CloudInput;
}
