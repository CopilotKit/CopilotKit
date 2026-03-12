import { AgentState, CardType, ChartData, EntityData, ItemData, NoteData, ProjectData } from "@/lib/canvas/types";

export const initialState: AgentState = {
  items: [],
  globalTitle: "",
  globalDescription: "",
  lastAction: "",
  itemsCreated: 0,
  planSteps: [],
  currentStepIndex: -1,
  planStatus: "",
};

export function isNonEmptyAgentState(value: unknown): value is AgentState {
  if (value == null || typeof value !== "object") return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0;
}

export function defaultDataFor(type: CardType): ItemData {
  switch (type) {
    case "project":
      return {
        field1: "",
        field2: "",
        field3: "",
        field4: [],
        field4_id: 0,
      } as ProjectData;
    case "entity":
      return {
        field1: "",
        field2: "",
        field3: [],
        field3_options: ["Tag 1", "Tag 2", "Tag 3"],
      } as EntityData;
    case "note":
      return { field1: "" } as NoteData;
    case "chart":
      return { field1: [], field1_id: 0 } as ChartData;
    default:
      return { field1: "" } as NoteData;
  }
}


