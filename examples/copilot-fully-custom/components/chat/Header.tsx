import { Avatar, Format, AvatarSize} from "@leafygreen-ui/avatar";
import Badge from "@leafygreen-ui/badge";

export function Header() {
    return (
        <div className="flex items-center justify-center gap-2 border py-4 rounded-t-xl bg-white">
            <Avatar format={Format.MongoDB} size={AvatarSize.Default} />
            <span className="text-lg font-bold">AI Assistant</span>
            <Badge variant="blue">Beta</Badge>
        </div>
    )
}