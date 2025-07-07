'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect } from 'react';

interface TabButtonProps {
  href: string;
  text: string;
  icon: React.ReactNode;
  className?: string;
  activeClassName?: string;
}

export function TabButton({ 
  href, 
  icon,
  text = "",
  className = "", 
  activeClassName = "bg-fd-primary/10 text-fd-primary", 
}: TabButtonProps) {
  const pathname = usePathname();
  
  const isActive = pathname.startsWith(href);

  return (
    <div className="w-full flex">
      <Link
        href={href}
        className={cn(
          "py-2 pl-2 rounded-xl transition-colors duration-200 w-full flex gap-2 items-center text-sm text-muted-foreground",
          isActive ? activeClassName : "hover:bg-fd-accent/50",
          className
        )}
      >
        {icon}
        {text}
      </Link>
    </div>
  );
}