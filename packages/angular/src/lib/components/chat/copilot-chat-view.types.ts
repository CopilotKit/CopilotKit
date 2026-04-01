import { Type, TemplateRef } from "@angular/core";
import { Message } from "@ag-ui/client";

/**
 * Props for CopilotChatView component
 */
export interface CopilotChatViewProps {
  messages?: Message[];
  autoScroll?: boolean;

  // Slot configurations
  messageViewComponent?: Type<any>;
  messageViewTemplate?: TemplateRef<any>;
  messageViewClass?: string;

  scrollViewComponent?: Type<any>;
  scrollViewTemplate?: TemplateRef<any>;
  scrollViewClass?: string;

  scrollToBottomButtonComponent?: Type<any>;
  scrollToBottomButtonTemplate?: TemplateRef<any>;
  scrollToBottomButtonClass?: string;

  inputComponent?: Type<any>;
  inputTemplate?: TemplateRef<any>;

  inputContainerComponent?: Type<any>;
  inputContainerTemplate?: TemplateRef<any>;
  inputContainerClass?: string;

  featherComponent?: Type<any>;
  featherTemplate?: TemplateRef<any>;
  featherClass?: string;

  disclaimerComponent?: Type<any>;
  disclaimerTemplate?: TemplateRef<any>;
  disclaimerClass?: string;
  disclaimerText?: string;
}

/**
 * Context for custom layout template
 */
export interface CopilotChatViewLayoutContext {
  messageView: any;
  input: any;
  scrollView: any;
  scrollToBottomButton: any;
  feather: any;
  inputContainer: any;
  disclaimer: any;
}
