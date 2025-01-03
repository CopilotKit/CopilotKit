import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { IconType } from "react-icons";

interface CTACardProps {
  icon: IconType;
  title: string;
  description: string;
  href: string;
  iconBgColor?: string;
}

interface CTACardsProps {
  cards: CTACardProps[];
}

export function CTACard({ icon: Icon, title, description, href, iconBgColor = "bg-indigo-500" }: CTACardProps) {
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

export function CTACards({ cards }: CTACardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 py-6">
      {cards.map((card, index) => (
        <CTACard key={index} {...card} />
      ))}
    </div>
  );
}