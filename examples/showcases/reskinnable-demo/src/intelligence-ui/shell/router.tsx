"use client";

/**
 * A react-router-shaped facade over Next's App Router, so the Intelligence
 * components copied into this folder keep their original `Link`, `useNavigate`
 * and `useLocation` calls unchanged.
 */
import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  readonly children?: ReactNode;
  readonly replace?: boolean;
  readonly state?: unknown;
  readonly to: string;
};

export function Link({ to, replace, state, children, ...rest }: LinkProps) {
  void state; // react-router location state has no App Router equivalent
  return (
    <NextLink href={to} replace={replace} {...rest}>
      {children}
    </NextLink>
  );
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => void {
  const router = useRouter();
  return (to, options) => (options?.replace ? router.replace(to) : router.push(to));
}

export function useLocation(): { pathname: string; search: string; hash: string } {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const search = params && params.toString() ? `?${params.toString()}` : "";
  return { pathname, search, hash: "" };
}
