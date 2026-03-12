"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Home,
    MessageSquare,
    Folder,
    BarChart3,
    HelpCircle,
    Settings,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface LeftSidebarProps {
    className?: string;
}

export default function LeftSidebar({ className }: LeftSidebarProps) {
    return (
        <aside className={cn("max-md:hidden h-full w-14 border-r bg-card", className)}>
            <div className="flex h-full flex-col items-center py-3 gap-3">
                {/* Brand */}
                <div className="mb-1 mt-1">
                    <Avatar className="size-10">
                        <AvatarFallback className="bg-accent/10 text-sidebar-primary-foreground">
                            <span>🪁</span>
                        </AvatarFallback>
                    </Avatar>
                </div>

                {/* Primary nav */}
                <nav className="mt-2 flex flex-col items-center gap-2">
                    <IconButton label="Home" icon={<Home className="size-4" />} />
                    <IconButton label="Chats" icon={<MessageSquare className="size-4" />} />
                    <IconButton label="Projects" icon={<Folder className="size-4" />} />
                    <IconButton label="Analytics" icon={<BarChart3 className="size-4" />} />
                </nav>

                <div className="mt-auto flex flex-col items-center gap-2">
                    <IconButton label="Help" icon={<HelpCircle className="size-4" />} />
                    <IconButton label="Settings" icon={<Settings className="size-4" />} />
                </div>
            </div>
        </aside>
    );
}

function IconButton({ label, icon }: { label: string; icon: React.ReactNode }) {
    return (
        <Button
            variant="ghost"
            size="icon"
            title={label}
            className={cn(
                "h-10 w-10 rounded-xl border bg-card/60",
                "hover:bg-accent/10 hover:border-accent/50"
            )}
        >
            {icon}
            <span className="sr-only">{label}</span>
        </Button>
    );
}


