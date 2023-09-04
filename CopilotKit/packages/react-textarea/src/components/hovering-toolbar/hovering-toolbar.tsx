import { css } from "@emotion/css";
import { useEffect, useMemo, useRef, useState } from "react";
import { BaseSelection, Editor, Range, Location, Transforms } from "slate";
import { useSlate, useSlateSelection } from "slate-react";
import {
  EditorState,
  HoveringEditingPromptBox,
} from "./hovering-editing-prompt-box";
import { Button, Icon, Menu, Portal } from "./hovering-toolbar-components";

export const HoveringToolbar: () => JSX.Element | null = () => {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useSlate();
  const selection = useSlateSelection();

  // only render on client
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  const [shouldDisplayHoveringToolbar, setShouldDisplayHoveringToolbar] =
    useState(false);

  // determine if hovering toolbar should be displayed
  useEffect(() => {
    if (!selection) {
      setShouldDisplayHoveringToolbar(false);
      return;
    }

    setShouldDisplayHoveringToolbar(true);
  }, [selection]);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    if (!shouldDisplayHoveringToolbar) {
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
  }, [selection, shouldDisplayHoveringToolbar]);

  if (!isClient || !shouldDisplayHoveringToolbar) {
    return null;
  }

  const editFunction = async (
    editorState: EditorState,
    editingPrompt: string
  ) => {
    console.log("editing prompt", editingPrompt);
    return editingPrompt;
  };

  return (
    <Portal>
      <Menu
        ref={ref}
        className="p-2 absolute z-10 top-[-10000px] left-[-10000px] mt-[-6px] opacity-0 transition-opacity duration-700"
      >
        {shouldDisplayHoveringToolbar && selection && (
          <HoveringEditingPromptBox
            editorState={editorState(editor, selection)}
            editFunction={editFunction}
            performEdit={(insertedText) => {
              console.log("inserted text", insertedText);
              Transforms.insertText(editor, insertedText, {
                at: Editor.end(editor, selection),
              });
            }}
          />
        )}
        {/* <FormatButton format="bold" icon="format_bold" />
        <FormatButton format="italic" icon="format_italic" />
        <FormatButton format="underlined" icon="format_underlined" /> */}
      </Menu>
    </Portal>
  );
};

function editorState(editor: Editor, selection: Location): EditorState {
  return {
    beforeSelection: "",
    selection: Editor.string(editor, selection),
    afterSelection: "",
  };
}

type Fomrat = string;

const FormatButton = ({ format, icon }: { format: Fomrat; icon: string }) => {
  const editor = useSlate();
  return (
    <Button
      reversed
      active={isMarkActive(editor, format)}
      onClick={() => toggleMark(editor, format)}
    >
      <Icon>{icon}</Icon>
    </Button>
  );
};

const toggleMark = (editor: Editor, format: Fomrat) => {
  const isActive = isMarkActive(editor, format);

  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const isMarkActive = (editor: Editor, format: Fomrat) => {
  return false;
  // const marks = Editor.marks(editor);
  // return marks ? marks[format] === true : false;
};
