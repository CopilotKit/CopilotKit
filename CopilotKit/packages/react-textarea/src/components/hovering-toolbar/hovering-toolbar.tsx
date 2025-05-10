import { useEffect, useRef, useState } from "react";
import { Editor, Location, Transforms } from "slate";
import { useSlate, useSlateSelection, ReactEditor } from "slate-react";
import { HoveringInsertionPromptBox } from "./text-insertion-prompt-box";
import { Menu, Portal } from "./hovering-toolbar-components";
import { useHoveringEditorContext } from "./hovering-editor-provider";
import {
  getFullEditorTextWithNewlines,
  getTextAroundSelection,
} from "../../lib/get-text-around-cursor";
import {
  EditingEditorState,
  InsertionEditorApiConfig,
} from "../../types/base/autosuggestions-bare-function";

export interface HoveringToolbarProps {
  apiConfig: InsertionEditorApiConfig;
  contextCategories: string[];
  hoverMenuClassname: string | undefined;
}

export const HoveringToolbar = (props: HoveringToolbarProps) => {
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
    const { selection } = editor;

    if (!el) {
      return;
    }

    if (!selection) {
      el.removeAttribute("style");
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      return;
    }

    const domRange = domSelection.getRangeAt(0);
    const rect = domRange.getBoundingClientRect();

    // We use window = (0,0,0,0) as a signal that the selection is not in the original copilot-textarea,
    // but inside the hovering window.
    //
    // in such case, we simply do nothing.
    if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) {
      return;
    }
    const minGapFromEdge = 60;
    const verticalOffsetFromCorner = 35;
    const horizontalOffsetFromCorner = 15;
    let top = rect.top + window.scrollY - el.offsetHeight + verticalOffsetFromCorner;
    // make sure top is in the viewport and not too close to the edge
    if (top < minGapFromEdge) {
      top = rect.bottom + window.scrollY + minGapFromEdge;
    } else if (top + el.offsetHeight > window.innerHeight - minGapFromEdge) {
      top = rect.top + window.scrollY - el.offsetHeight - minGapFromEdge;
    }

    let left =
      rect.left + window.scrollX - el.offsetWidth / 2 + rect.width / 2 + horizontalOffsetFromCorner;
    // make sure left is in the viewport and not too close to the edge
    if (left < minGapFromEdge) {
      left = minGapFromEdge;
    } else if (left + el.offsetWidth > window.innerWidth - minGapFromEdge) {
      left = window.innerWidth - el.offsetWidth - minGapFromEdge;
    }

    el.style.opacity = "1";
    el.style.position = "absolute";

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  // Close the window when clicking outside or pressing escape
  useEffect(() => {
    const doc = ref.current?.ownerDocument;

    if (!doc || !isDisplayed) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        // Restore focus to the editor when closing
        ReactEditor.focus(editor);
        setIsDisplayed(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        ReactEditor.focus(editor);
        setIsDisplayed(false);
      }
    };

    doc.addEventListener("mousedown", handleClickOutside);
    doc.addEventListener("keydown", handleKeyDown);

    return () => {
      doc.removeEventListener("mousedown", handleClickOutside);
      doc.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref, setIsDisplayed, isDisplayed, editor]);

  if (!isClient) {
    return null;
  }

  return (
    <Portal>
      <Menu
        ref={ref}
        className={
          "copilot-kit-textarea-css-scope " +
          (props.hoverMenuClassname ||
            "p-2 absolute z-10 top-[-10000px] left-[-10000px] mt-[-6px] opacity-0 transition-opacity duration-700")
        }
        data-testid="hovering-toolbar"
      >
      { isDisplayed && selection ? (
        <HoveringInsertionPromptBox
          editorState={editorState(editor, selection)}
          apiConfig={props.apiConfig}
          performInsertion={(insertedText) => {
            // replace the selection with the inserted text
            Transforms.delete(editor, { at: selection });
            Transforms.insertText(editor, insertedText, {
              at: selection,
            });
            setIsDisplayed(false);
          }}
          contextCategories={props.contextCategories}
        />
      ) : null}
    </Menu>
    </Portal>
  );
};

function editorState(editor: Editor, selection: Location): EditingEditorState {
  const textAroundCursor = getTextAroundSelection(editor);
  if (textAroundCursor) {
    return textAroundCursor;
  }

  return {
    textBeforeCursor: getFullEditorTextWithNewlines(editor),
    textAfterCursor: "",
    selectedText: "",
  };
}
