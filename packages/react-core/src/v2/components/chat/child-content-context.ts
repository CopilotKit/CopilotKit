import { createContext } from "react";
import type { ContentPart } from "@ag-ui/core";

/** Scoped per child namespace: native message IDs can repeat across siblings. */
export const ChildContentContext = createContext<
  ReadonlyMap<string, ContentPart[]>
>(new Map());

export const ChildHistoryReadOnlyContext = createContext(false);
