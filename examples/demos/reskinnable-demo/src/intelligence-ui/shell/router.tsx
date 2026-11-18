"use client";

/**
 * A react-router-shaped facade over Next's App Router, so the Intelligence
 * components copied into this folder keep their original `Link`, `NavLink`,
 * `useNavigate`, `useLocation` and `useSearchParams` calls unchanged.
 */
import NextLink from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";
import { useCallback, useMemo } from "react";
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

type NavLinkProps = Omit<LinkProps, "className"> & {
  readonly className?: string | ((args: { isActive: boolean }) => string);
  readonly end?: boolean;
};

/** react-router's `NavLink`: active when the path matches `to` (exactly with `end`). */
export function NavLink({ to, end = false, className, ...rest }: NavLinkProps) {
  const pathname = usePathname() ?? "/";
  const target = to.split("?")[0]!.replace(/\/$/, "");
  const isActive = end
    ? pathname.replace(/\/$/, "") === target
    : pathname === target || pathname.startsWith(`${target}/`);
  const cls =
    typeof className === "function" ? className({ isActive }) : className;
  return (
    <Link
      to={to}
      className={cls}
      aria-current={isActive ? "page" : undefined}
      {...rest}
    />
  );
}

export function useNavigate(): (
  to: string,
  options?: { replace?: boolean; state?: unknown },
) => void {
  const router = useRouter();
  return (to, options) =>
    options?.replace ? router.replace(to) : router.push(to);
}

export function useLocation(): {
  pathname: string;
  search: string;
  hash: string;
} {
  const pathname = usePathname() ?? "/";
  const params = useNextSearchParams();
  const search = params && params.toString() ? `?${params.toString()}` : "";
  return { pathname, search, hash: "" };
}

type SetSearchParams = (
  next:
    | URLSearchParams
    | Record<string, string>
    | ((prev: URLSearchParams) => URLSearchParams | Record<string, string>),
  options?: { replace?: boolean; preventScrollReset?: boolean },
) => void;

/** react-router's `[searchParams, setSearchParams]` over the App Router. */
export function useSearchParams(): [URLSearchParams, SetSearchParams] {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const raw = useNextSearchParams();
  const params = useMemo(
    () => new URLSearchParams(raw?.toString() ?? ""),
    [raw],
  );
  const set = useCallback<SetSearchParams>(
    (next, options) => {
      const value =
        typeof next === "function" ? next(new URLSearchParams(params)) : next;
      const out =
        value instanceof URLSearchParams ? value : new URLSearchParams(value);
      const qs = out.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (options?.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [params, pathname, router],
  );
  return [params, set];
}
