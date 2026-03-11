import { Field, InputType, Int, createUnionType } from "type-graphql";

const PrimitiveUnion = createUnionType({
  name: "Primitive",
  types: () => [String, Number, Boolean] as const,
});

@InputType()
export class CustomPropertyInput {
  @Field(() => String)
  key: string;

  @Field(() => PrimitiveUnion)
  value: string;
}
