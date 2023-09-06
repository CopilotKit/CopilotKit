import { css } from "@emotion/css";
import { useEffect, useMemo, useRef, useState } from "react";
import { BaseSelection, Editor, Range, Location, Transforms } from "slate";
import { useSlate, useSlateSelection } from "slate-react";
import {
  HoveringInsertionPromptBox,
  InsertionEditorState,
} from "./text-insertion-prompt-box";
import { Button, Icon, Menu, Portal } from "./hovering-toolbar-components";
import { useHoveringEditorContext } from "./hovering-editor-provider";
import {
  getFullEditorTextWithNewlines,
  getTextAroundCollapsedCursor,
} from "../../lib/get-text-around-cursor";

export const HoveringToolbar: () => JSX.Element | null = () => {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useSlate();
  const selection = useSlateSelection();
  const { isDisplayed, setIsDisplayed } = useHoveringEditorContext();

  // only render on client
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    if (!isDisplayed) {
      el.removeAttribute("style");
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection) {
      return;
    }

    const domRange = domSelection.getRangeAt(0);
    const rect = domRange.getBoundingClientRect();

    const minGapFromEdge = 60;
    let top = rect.top + window.scrollY - el.offsetHeight;
    // make sure top is in the viewport and not too close to the edge
    if (top < minGapFromEdge) {
      top = rect.bottom + window.scrollY + minGapFromEdge;
    } else if (top + el.offsetHeight > window.innerHeight - minGapFromEdge) {
      top = rect.top + window.scrollY - el.offsetHeight - minGapFromEdge;
    }

    let left = rect.left + window.scrollX - el.offsetWidth / 2 + rect.width / 2;
    // make sure left is in the viewport and not too close to the edge
    if (left < minGapFromEdge) {
      left = minGapFromEdge;
    } else if (left + el.offsetWidth > window.innerWidth - minGapFromEdge) {
      left = window.innerWidth - el.offsetWidth - minGapFromEdge;
    }

    el.style.opacity = "1";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [selection, isDisplayed]);

  if (!isClient || !isDisplayed) {
    return null;
  }

  const insertionFunction = async (
    state: InsertionEditorState,
    prompt: string
  ) => {
    console.log("prompt", prompt);
    return prompt;
  };

  return (
    <Portal>
      <Menu
        ref={ref}
        className="p-2 absolute z-10 top-[-10000px] left-[-10000px] mt-[-6px] opacity-0 transition-opacity duration-700"
      >
        {isDisplayed && selection && (
          <HoveringInsertionPromptBox
            editorState={editorState(editor, selection)}
            insertionFunction={insertionFunction}
            closeWindow={() => {
              setIsDisplayed(false);
            }}
            performInsertion={(insertedText) => {
              console.log("inserted text", insertedText);
              // replace the selection with the inserted text
              Transforms.delete(editor, { at: selection });
              Transforms.insertText(editor, insertedText, {
                at: selection,
              });
              // hide the hovering editor
              setIsDisplayed(false);
            }}
          />
        )}
      </Menu>
    </Portal>
  );
};

function editorState(
  editor: Editor,
  selection: Location
): InsertionEditorState {
  const textAroundCursor = getTextAroundCollapsedCursor(editor);
  if (textAroundCursor) {
    return textAroundCursor;
  }

  return {
    textBeforeCursor: getFullEditorTextWithNewlines(editor),
    textAfterCursor: "",
  };
}
