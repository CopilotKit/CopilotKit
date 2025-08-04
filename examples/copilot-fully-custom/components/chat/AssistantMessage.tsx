import Card from "@leafygreen-ui/card";
import { Avatar, Format, AvatarSize} from "@leafygreen-ui/avatar";
import {Spinner} from "@leafygreen-ui/loading-indicator";
import Button from "@leafygreen-ui/button";
import Icon from "@leafygreen-ui/icon";

import "@copilotkit/react-ui/styles.css";
import { AssistantMessageProps, Markdown } from "@copilotkit/react-ui";
import { useCopilotChat } from "@copilotkit/react-core";
 
export const CustomAssistantMessage = (props: AssistantMessageProps) => {
  const { message, isLoading, isGenerating, subComponent, rawData} = props;
  const id = rawData?.id;
  return (
    <div className="py-2">
      <div className="flex items-end gap-2">
        {!subComponent && <Avatar format={Format.MongoDB} size={AvatarSize.XLarge} />}
        {subComponent ? 
          subComponent : 
          <Card className="flex w-full justify-start flex-col">
            {message && <Markdown content={message.content || ""} /> }
            {isLoading && <div className="flex justify-start"><Spinner /></div>}
            {!isGenerating && !isLoading && <ResponseButtons id={id} />}
          </Card>
        }
      </div>
    </div>
  );
};

const ResponseButtons = ({ id }: { id: string }) => {
    const { reloadMessages } = useCopilotChat(); 

    return (
        <div className="flex gap-2 items-center mt-6">
            <p className="text-gray-500">How was this response?</p>
            <Button size={"xsmall"} onClick={() => alert("Thumbs up sent")}><Icon glyph="ThumbsUp" /></Button>
            <Button size={"xsmall"} onClick={() => alert("Thumbs down sent")}><Icon glyph="ThumbsDown" /></Button>
            <div className="flex gap-2 items-center">
                |
                <Button size={"xsmall"} onClick={() => reloadMessages(id)}><Icon glyph="Refresh" /></Button>
            </div>
        </div>
    )
}