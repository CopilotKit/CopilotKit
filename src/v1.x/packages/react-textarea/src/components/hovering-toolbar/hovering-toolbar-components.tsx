import { css, cx } from "@emotion/css";
import React, { PropsWithChildren, Ref } from "react";
import ReactDOM from "react-dom";

interface BaseProps {
  className?: string;
  [key: string]: unknown;
}

export const Button = React.forwardRef<
  HTMLSpanElement,
  PropsWithChildren<{ active: boolean; reversed: boolean } & BaseProps>
>(({ className, active, reversed, ...props }, ref) => (
  <span
    {...props}
    ref={ref}
    className={cx(
      className as string,
      css`
        cursor: pointer;
        color: ${reversed ? (active ? "white" : "#aaa") : active ? "black" : "#ccc"};
      `,
    )}
  />
));

export const Icon = React.forwardRef<HTMLSpanElement, PropsWithChildren<BaseProps>>(
  ({ className, ...props }, ref) => (
    <span
      {...props}
      ref={ref}
      className={cx(
        "material-icons",
        className as string,
        css`
          font-size: 18px;
          vertical-align: text-bottom;
        `,
      )}
    />
  ),
);

export const Menu = React.forwardRef<HTMLDivElement, PropsWithChildren<BaseProps>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        {...props}
        data-testid="menu"
        ref={ref}
        className={cx(
          className as string,
          css`
            & > * {
              display: inline-block;
            }

            & > * + * {
              margin-left: 15px;
            }
          `,
        )}
      />
    );
  },
);
export const Portal = ({ children }: { children: React.ReactNode }) => {
  return typeof document === "object" ? ReactDOM.createPortal(children, document.body) : null;
};

export const Toolbar = React.forwardRef<HTMLDivElement, PropsWithChildren<BaseProps>>(
  ({ className, ...props }, ref) => (
    <Menu
      {...props}
      ref={ref}
      className={cx(
        className as string,
        css`
          position: relative;
          padding: 1px 18px 17px;
          margin: 0 -20px;
          border-bottom: 2px solid #eee;
          margin-bottom: 20px;
        `,
      )}
    />
  ),
);
