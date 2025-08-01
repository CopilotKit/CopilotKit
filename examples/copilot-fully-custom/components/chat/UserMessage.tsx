import { Markdown, UserMessageProps } from "@copilotkit/react-ui";
import { Avatar, Format, AvatarSize} from "@leafygreen-ui/avatar";
import Card from "@leafygreen-ui/card";

export const CustomUserMessage = (props: UserMessageProps) => {
  const wrapperStyles = "flex items-end gap-2 justify-end mt-4 w-full";
  const messageStyles = "bg-emerald-500 flex items-end justify-end text-white"
  const avatarStyles = "text-sm bg-emerald-500"
 
  return (
    <div className={wrapperStyles}>
      <Card className={messageStyles}><Markdown content={props.message?.content || ""} /></Card>
      <Avatar format={Format.Icon} glyph="Person" size={AvatarSize.XLarge} className={avatarStyles} />
    </div>
  );
};
