"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface BrokenLinkHandlerProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  fallbackHref?: string;
  showWarning?: boolean;
}

export function BrokenLinkHandler({ 
  href, 
  children, 
  className, 
  fallbackHref = "/",
  showWarning = true 
}: BrokenLinkHandlerProps) {
  const [isBroken, setIsBroken] = useState(false);
  const [isExternal, setIsExternal] = useState(false);

  useEffect(() => {
    // Check if it's an external link
    if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      setIsExternal(true);
      return;
    }

    // For internal links, we could add validation here
    // For now, we'll assume internal links are valid
    setIsExternal(false);
  }, [href]);

  const handleClick = (e: React.MouseEvent) => {
    if (isExternal) {
      // Let external links open normally
      return;
    }

    // For internal links, we could add validation
    // This is a placeholder for future link validation
  };

  if (isExternal) {
    return (
      <Link
        href={href}
        className={`${className} inline-flex items-center gap-1`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        {children}
        <ExternalLink className="w-3 h-3 opacity-60" />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      onClick={handleClick}
    >
      {children}
      {showWarning && isBroken && (
        <AlertTriangle className="w-3 h-3 text-yellow-500 ml-1" />
      )}
    </Link>
  );
}

// Enhanced NavigationLink with better error handling
export function EnhancedNavigationLink({
  href,
  children,
  className,
  ...props
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: any;
}) {
  const [linkStatus, setLinkStatus] = useState<'loading' | 'valid' | 'broken'>('loading');

  useEffect(() => {
    // Simple validation for internal links
    if (href.startsWith('/') && !href.startsWith('//')) {
      // This is a basic check - in a real implementation, you'd want to
      // validate against your actual route structure
      setLinkStatus('valid');
    } else if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      setLinkStatus('valid');
    } else {
      setLinkStatus('broken');
    }
  }, [href]);

  if (linkStatus === 'broken') {
    return (
      <span className={`${className} text-red-600 dark:text-red-400 cursor-not-allowed`} title="This link appears to be broken">
        {children}
        <AlertTriangle className="w-3 h-3 inline ml-1" />
      </span>
    );
  }

  return (
    <Link href={href} className={className} {...props}>
      {children}
    </Link>
  );
}
