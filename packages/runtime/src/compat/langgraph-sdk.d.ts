// @ag-ui/langgraph 0.0.42 publishes declaration-only imports from two private
// LangGraph SDK paths that are blocked by the SDK's exports map. Keep this
// ambient bridge type-only and derive both contracts from the public SDK root.
// oxlint-disable typescript/consistent-type-imports -- a top-level import would turn these ambient declarations into invalid module augmentations
declare module "@langchain/langgraph-sdk/dist/types.stream" {
  export type TypedAsyncGenerator<
    _TStreamMode = unknown,
    _TSubgraphs extends boolean = false,
    _TValues = unknown,
    _TUpdates = unknown,
    _TCustom = unknown,
  > = ReturnType<import("@langchain/langgraph-sdk").Client["runs"]["stream"]>;
}

declare module "@langchain/langgraph-sdk/dist/types" {
  export type RunsStreamPayload<
    _TStreamMode = unknown,
    _TSubgraphs extends boolean = false,
  > = NonNullable<
    Parameters<import("@langchain/langgraph-sdk").Client["runs"]["stream"]>[2]
  > & { input: unknown };
}
