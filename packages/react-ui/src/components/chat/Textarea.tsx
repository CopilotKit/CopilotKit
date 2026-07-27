import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";

interface AutoResizingTextareaProps {
  maxRows?: number;
  placeholder?: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  autoFocus?: boolean;
  "data-testid"?: string;
}

const AutoResizingTextarea = forwardRef<
  HTMLTextAreaElement,
  AutoResizingTextareaProps
>(
  (
    {
      maxRows = 1,
      placeholder,
      value,
      onChange,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      autoFocus,
      "data-testid": dataTestId,
    },
    ref,
  ) => {
    const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [maxHeight, setMaxHeight] = useState<number>(0);

    useImperativeHandle(
      ref,
      () => internalTextareaRef.current as HTMLTextAreaElement,
    );

    useEffect(() => {
      const calculateMaxHeight = () => {
        const textarea = internalTextareaRef.current;
        if (textarea) {
          textarea.style.height = "auto";
          const singleRowHeight = textarea.scrollHeight;
          setMaxHeight(singleRowHeight * maxRows);
          if (autoFocus) {
            textarea.focus();
          }
        }
      };

      calculateMaxHeight();
    }, [maxRows]);

    useEffect(() => {
      const textarea = internalTextareaRef.current;
      if (textarea) {
        // Save cursor position before height reset — Chrome reflows on `height = "auto"`
        // which resets selectionStart/End to the end of the text (issue #6167).
        const { selectionStart, selectionEnd, selectionDirection } = textarea;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        if (document.activeElement === textarea) {
          textarea.setSelectionRange(
            selectionStart,
            selectionEnd,
            selectionDirection as "forward" | "backward" | "none",
          );
        }
      }
    }, [value, maxHeight]);

    return (
      <textarea
        ref={internalTextareaRef}
        data-testid={dataTestId}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        style={{
          overflow: "auto",
          resize: "none",
          maxHeight: `${maxHeight}px`,
        }}
        rows={1}
      />
    );
  },
);

export default AutoResizingTextarea;
