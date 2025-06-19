'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { IconType } from "react-icons";
import { BotIcon, WrenchIcon, Pause, Share2, Bot, Wrench, MessageSquare, LayoutTemplate, Wand, UserCog, Play } from "lucide-react";
import { ReactNode } from "react";

// Icon resolver function for CTACards
function getIconByKey(iconKey: string): React.ComponentType<any> {
  switch (iconKey) {
    case 'bot':
      return BotIcon;
    case 'boticon':
      return Bot;
    case 'wrench':
      return WrenchIcon;
    case 'wrenchicon':
      return Wrench;
    case 'pause':
      return Pause;
    case 'share2':
      return Share2;
    case 'message-square':
      return MessageSquare;
    case 'layout-template':
      return LayoutTemplate;
    case 'wand':
      return Wand;
    case 'user-cog':
      return UserCog;
    case 'play':
      return Play;
    default:
      return BotIcon;
  }
}

interface CTACardProps {
  icon?: IconType;
  iconKey?: string;
  title: string;
  description: string;
  href: string;
  iconBgColor?: string;
}

interface CTACardsProps {
  cards: CTACardProps[];
  columns?: 1 | 2 | 3 | 4;
}

export function CTACard({ icon, iconKey, title, description, href, iconBgColor = "bg-indigo-500" }: CTACardProps) {
  const Icon = icon || (iconKey ? getIconByKey(iconKey) : BotIcon);
  
  return (
    <Link href={href} className="no-underline">
      <Card className="transition-transform hover:scale-105 cursor-pointer shadow-xl shadow-indigo-500/20 h-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center ${iconBgColor} rounded-full w-10 h-10`}>
              <Icon className="h-6 w-6 text-white"/>
            </div>
            <CardTitle className="text-md">{title}</CardTitle>
          </div>
          <CardDescription className="text-md pt-4">{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

export function CTACards({ cards, columns = 3 }: CTACardsProps) {
  const lastItemClass = cards.length % columns !== 0 ? `xl:col-span-${columns - (cards.length % columns) + 1}` : '';

  return (
    <div className={`grid grid-cols-1 gap-y-8 gap-x-10 xl:grid-cols-${columns} py-6`}>
      {cards.map((card, index) => (
        <div
          key={index}
          className={index === cards.length - 1 ? lastItemClass : ''}
        >
          <CTACard {...card} />
        </div>
      ))}
    </div>
  );
}