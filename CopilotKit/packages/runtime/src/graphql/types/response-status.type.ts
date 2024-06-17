import { Field, InterfaceType, ObjectType, createUnionType, registerEnumType } from "type-graphql";

export enum ResponseStatusCode {
  Pending = "pending",
  Success = "success",
  Failed ="failed",
}

registerEnumType(ResponseStatusCode, {
  name: "ResponseStatusCode"
})

@InterfaceType({
  resolveType(value) {
    if (value.code === ResponseStatusCode.Success) {
      return SuccessResponseStatus;
    } else if (value.code === ResponseStatusCode.Failed) {
      return FailedResponseStatus;
    } else if (value.code === ResponseStatusCode.Pending) {
      return PendingResponseStatus;
    }
    return undefined;
  },
})


@ObjectType()
abstract class BaseResponseStatus {
  @Field(() => ResponseStatusCode)
  code: ResponseStatusCode;
}

@ObjectType({ implements: BaseResponseStatus })
export class PendingResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Pending;
}

@ObjectType({ implements: BaseResponseStatus })
export class SuccessResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Success;
}

@ObjectType({ implements: BaseResponseStatus })
export class FailedResponseStatus extends BaseResponseStatus {
  code: ResponseStatusCode = ResponseStatusCode.Failed;

  @Field(() => String)
  reason: string;
}

export const ResponseStatusUnion = createUnionType({
  name: "ResponseStatus",
  types: () => [PendingResponseStatus, SuccessResponseStatus, FailedResponseStatus] as const,
});
