import type { ComponentProps, MouseEvent } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { buttonVariants } from "../primitives/actions";
import type { ActionSize } from "../primitives/actions";
import { classNames } from "../class-names";
import styles from "./registry-pagination.module.css";

/** Generated shadcn Pagination root with the collection's accessible label. */
export function Pagination({
  className,
  ...props
}: ComponentProps<"nav">): React.JSX.Element {
  return (
    <nav
      aria-label="pagination"
      className={classNames(styles.pagination, className)}
      data-slot="pagination"
      role="navigation"
      {...props}
    />
  );
}

/** Horizontal list of numbered page controls. */
export function PaginationContent({
  className,
  ...props
}: ComponentProps<"ul">): React.JSX.Element {
  return (
    <ul
      className={classNames(styles.content, className)}
      data-slot="pagination-content"
      {...props}
    />
  );
}

/** List item wrapper for each page control. */
export function PaginationItem(props: ComponentProps<"li">): React.JSX.Element {
  return <li data-slot="pagination-item" {...props} />;
}

export interface PaginationLinkProps extends ComponentProps<"a"> {
  readonly isActive?: boolean;
  readonly size?: ActionSize;
}

/** Link-style page control with a native href for deep links and modifiers. */
export function PaginationLink({
  children,
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps): React.JSX.Element {
  const look = buttonVariants({
    size,
    variant: isActive ? "outline" : "ghost",
  });
  return (
    <a
      {...look}
      aria-current={isActive ? "page" : undefined}
      className={classNames(look.className, styles.link, className)}
      data-active={isActive}
      data-slot="pagination-link"
      {...props}
    >
      {children}
    </a>
  );
}

/** Previous-page link with a stable accessible name. */
export function PaginationPrevious({
  className,
  ...props
}: PaginationLinkProps): React.JSX.Element {
  return (
    <PaginationLink
      aria-label="Previous page"
      className={classNames(styles.edge, className)}
      size="md"
      {...props}
    >
      <ChevronLeft aria-hidden="true" size={14} />
      <span>Previous</span>
    </PaginationLink>
  );
}

/** Next-page link with a stable accessible name. */
export function PaginationNext({
  className,
  ...props
}: PaginationLinkProps): React.JSX.Element {
  return (
    <PaginationLink
      aria-label="Next page"
      className={classNames(styles.edge, className)}
      size="md"
      {...props}
    >
      <span>Next</span>
      <ChevronRight aria-hidden="true" size={14} />
    </PaginationLink>
  );
}

/** Skipped page range, hidden from assistive navigation. */
export function PaginationEllipsis({
  className,
  ...props
}: ComponentProps<"span">): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={classNames(styles.ellipsis, className)}
      data-slot="pagination-ellipsis"
      {...props}
    >
      <MoreHorizontal aria-hidden="true" size={16} />
    </span>
  );
}

export interface CollectionPaginationProps {
  readonly hrefForPage: (page: number) => string;
  readonly label: string;
  readonly onPageChange: (page: number) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface CursorCollectionPaginationProps {
  readonly hasNext: boolean;
  readonly label: string;
  readonly onPageChange: (page: number) => void;
  readonly page: number;
}

/** Centers pagination for cursor APIs without suggesting a known last page. */
export function CursorCollectionPagination(
  props: CursorCollectionPaginationProps,
): React.JSX.Element | null {
  const current = Math.max(1, props.page);
  if (current === 1 && !props.hasNext) return null;
  const edge = buttonVariants({ size: "md", variant: "ghost" });
  const page = buttonVariants({ size: "icon", variant: "ghost" });
  const currentPage = buttonVariants({ size: "icon", variant: "outline" });
  return (
    <Pagination aria-label={`${props.label} pagination`}>
      <PaginationContent>
        <PaginationItem>
          <button
            {...edge}
            aria-label="Previous page"
            className={classNames(edge.className, styles.link, styles.edge)}
            disabled={current === 1}
            onClick={() => props.onPageChange(current - 1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={14} />
            <span>Previous</span>
          </button>
        </PaginationItem>
        {current > 1 ? (
          <PaginationItem>
            <button
              {...page}
              aria-label={`Page ${current - 1}`}
              className={classNames(page.className, styles.link)}
              onClick={() => props.onPageChange(current - 1)}
              type="button"
            >
              {current - 1}
            </button>
          </PaginationItem>
        ) : null}
        <PaginationItem>
          <button
            {...currentPage}
            aria-current="page"
            aria-label={`Page ${current}`}
            className={classNames(currentPage.className, styles.link)}
            type="button"
          >
            {current}
          </button>
        </PaginationItem>
        <PaginationItem>
          <button
            {...edge}
            aria-label="Next page"
            className={classNames(edge.className, styles.link, styles.edge)}
            disabled={!props.hasNext}
            onClick={() => props.onPageChange(current + 1)}
            type="button"
          >
            <span>Next</span>
            <ChevronRight aria-hidden="true" size={14} />
          </button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

/** Centers the reference's numbered pager while preserving real link navigation. */
export function CollectionPagination(
  props: CollectionPaginationProps,
): React.JSX.Element | null {
  const count = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (count <= 1) return null;
  const current = Math.min(count, Math.max(1, props.page));
  const numbers =
    count <= 5
      ? Array.from({ length: count }, (_, index) => index + 1)
      : current <= 3
        ? [1, 2, 3, -1, count]
        : current >= count - 2
          ? [1, -1, count - 2, count - 1, count]
          : [1, -1, current, -2, count];
  const choose =
    (next: number, disabled = false) =>
    (event: MouseEvent<HTMLAnchorElement>): void => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      props.onPageChange(next);
    };
  return (
    <Pagination aria-label={`${props.label} pagination`}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={current === 1}
            href={props.hrefForPage(Math.max(1, current - 1))}
            onClick={choose(current - 1, current === 1)}
            tabIndex={current === 1 ? -1 : 0}
          />
        </PaginationItem>
        {numbers.map((number) => (
          <PaginationItem key={number}>
            {number < 0 ? (
              <PaginationEllipsis />
            ) : (
              <PaginationLink
                aria-label={`Page ${number}`}
                href={props.hrefForPage(number)}
                isActive={number === current}
                onClick={choose(number)}
              >
                {number}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            aria-disabled={current === count}
            href={props.hrefForPage(Math.min(count, current + 1))}
            onClick={choose(current + 1, current === count)}
            tabIndex={current === count ? -1 : 0}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
