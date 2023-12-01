import React, { useEffect, useRef } from "react";
import { BaseSelection } from "slate";
import { useSlateSelector } from "slate-react";
import { Range } from "slate";
import { editorToText } from "../../lib/editor-to-text";

interface TrackerTextEditedSinceLastCursorMovementProps {
  setCursorMovedSinceLastTextChange: (value: boolean) => void;
}
export function TrackerTextEditedSinceLastCursorMovement(
  props: TrackerTextEditedSinceLastCursorMovementProps,
): JSX.Element {
  const cursorState: RelevantEditorState = useSlateSelector((state) => ({
    selection: state.selection,
    text: editorToText(state),
  }));

  const previousState = usePrevious(cursorState);

  useEffect(() => {
    if (!previousState) {
      return;
    }

    if (cursorChangedWithoutTextChanged(previousState, cursorState)) {
      props.setCursorMovedSinceLastTextChange(true);
    }
  }, [props.setCursorMovedSinceLastTextChange, cursorState]);

  return <></>;
}
type RelevantEditorState = {
  selection: BaseSelection;
  text: string;
};
const cursorChangedWithoutTextChanged = (prev: RelevantEditorState, next: RelevantEditorState) => {
  // Check if the selection has changed
  const isSelectionChanged = !isSelectionEqual(prev.selection, next.selection);

  // Check if the text content remains the same
  const isTextSame = prev.text === next.text;

  return isSelectionChanged && isTextSame;
};
const isSelectionEqual = (a: BaseSelection, b: BaseSelection) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Range.equals(a, b);
};
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  });

  return ref.current;
}
