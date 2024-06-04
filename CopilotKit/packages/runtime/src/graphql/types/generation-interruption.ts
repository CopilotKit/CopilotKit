import { Field, ObjectType } from "type-graphql";

@ObjectType()
export class GenerationInterruption {
  @Field(() => Boolean)
  interrupted: boolean;

  @Field(() => String, { nullable: true })
  reason?: string;
}

