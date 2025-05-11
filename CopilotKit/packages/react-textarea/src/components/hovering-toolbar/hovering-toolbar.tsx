import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Editor, Location, Transforms } from "slate";
import { useSlate, useSlateSelection } from "slate-react";
import {
  getFullEditorTextWithNewlines,
  getTextAroundSelection,
} from "../../lib/get-text-around-cursor";
import {
  EditingEditorState,
  InsertionEditorApiConfig,
} from "../../types/base/autosuggestions-bare-function";
import { useHoveringEditorContext } from "./hovering-editor-provider";
import { Menu, Portal } from "./hovering-toolbar-components";
import { HoveringInsertionPromptBox } from "./text-insertion-prompt-box";

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

  const isShown = isClient && isDisplayed && selection;

  useLayoutEffect(() => {
    const el = ref.current;
    const { selection } = editor;

    if (!el || !isShown) {
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

    const verticalOffsetFromCorner = 0;
    const horizontalOffsetFromCorner = 0;

    // position the toolbar below the selection
    let top = rect.bottom + window.scrollY + verticalOffsetFromCorner;

    // no space left at bottom, move up
    if (rect.bottom + el.offsetHeight > window.innerHeight - verticalOffsetFromCorner) {
      top = rect.top + window.scrollY - el.offsetHeight - verticalOffsetFromCorner;
    }

    // position the toolbar in the center of the selection
    let left =
      rect.left + window.scrollX - el.offsetWidth / 2 + rect.width / 2 + horizontalOffsetFromCorner;

    // no space left at left, move right
    if (left < horizontalOffsetFromCorner) {
      left = horizontalOffsetFromCorner;
    }
    // no space left at right, move left
    else if (left + el.offsetWidth > window.innerWidth - horizontalOffsetFromCorner) {
      left = window.innerWidth - el.offsetWidth - horizontalOffsetFromCorner;
    }

    el.style.opacity = "1";
    el.style.position = "absolute";

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [isShown]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsDisplayed(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, setIsDisplayed]);

  if (!isShown) {
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
