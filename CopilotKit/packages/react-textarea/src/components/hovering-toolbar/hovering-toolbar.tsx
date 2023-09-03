import { css } from "@emotion/css";
import { useEffect, useRef, useState } from "react";
import { Editor, Range } from "slate";
import { useSlate } from "slate-react";
import { Button, Icon, Menu, Portal } from "./hovering-toolbar-components";
import { EditingPromptBox } from "./edit-prompter";

export const HoveringToolbar: () => JSX.Element | null = () => {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useSlate();

  useEffect(() => {
    const el = ref.current;
    const { selection } = editor;

    if (!el) {
      return;
    }

    if (
      !selection ||
      Range.isCollapsed(selection) ||
      Editor.string(editor, selection) === ""
    ) {
      el.removeAttribute("style");
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection) {
      return;
    }
    
    const domRange = domSelection.getRangeAt(0);
    const rect = domRange.getBoundingClientRect();
    el.style.opacity = "1";

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

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });

  // only render on client
  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  return (
    <Portal>
      <Menu
        ref={ref}
        className={css`
          width: 500px;
          padding: 8px 7px 6px;
          position: absolute;
          z-index: 1;
          top: -10000px;
          left: -10000px;
          margin-top: -6px;
          opacity: 0;
          background-color: #222;
          border-radius: 4px;
          transition: opacity 0.75s;
        `}
        onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
          // prevent toolbar from taking focus away from editor
          // e.preventDefault();
        }}
      >
        <TexteditPromptBox />
        {/* <FormatButton format="bold" icon="format_bold" />
        <FormatButton format="italic" icon="format_italic" />
        <FormatButton format="underlined" icon="format_underlined" /> */}
      </Menu>
    </Portal>
  );
};

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
