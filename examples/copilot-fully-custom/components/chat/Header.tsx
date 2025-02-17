import { Avatar, Format, AvatarSize} from "@leafygreen-ui/avatar";

export function Header() {
    return (
        <div className="flex items-center justify-center gap-2 border py-4 rounded-t-xl bg-white">
            <Avatar format={Format.Icon} glyph="Sparkle" size={AvatarSize.Default} className="bg-black" />
            <span className="text-lg font-bold">AI Assistant</span>
        </div>
    )
}