import { BasePoint } from "slate";
import { arraysAreEqual } from "../../lib/utils";

export interface EditorAutocompleteState {
  cursorPoint: BasePoint;
  textBeforeCursor: string;
  textAfterCursor: string;
}

export function areEqual_autocompleteState(
  prev: EditorAutocompleteState,
  next: EditorAutocompleteState,
) {
  return (
    prev.cursorPoint.offset === next.cursorPoint.offset &&
    arraysAreEqual(prev.cursorPoint.path, next.cursorPoint.path) &&
    prev.textBeforeCursor === next.textBeforeCursor &&
    prev.textAfterCursor === next.textAfterCursor
  );
}
