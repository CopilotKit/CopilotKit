import { css, cx } from "@emotion/css";
import React from "react";
import ReactDOM from "react-dom";

type ButtonProps = React.HTMLAttributes<HTMLSpanElement> & {
  active?: boolean;
  reversed?: boolean;
  className?: string;
};

type IconProps = React.HTMLAttributes<HTMLSpanElement> & {
  className?: string;
};

type MenuProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export const Button = React.forwardRef<HTMLSpanElement, ButtonProps>(
  ({ className, active = false, reversed = false, ...props }, ref) => (
    <span
      {...props}
      ref={ref}
      className={cx(
        className,
        css`
          cursor: pointer;
          color: ${reversed ? (active ? "white" : "#aaa") : active ? "black" : "#ccc"};
        `,
      )}
    />
  ),
);

export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(
  ({ className, ...props }, ref) => (
    <span
      {...props}
      ref={ref}
      className={cx(
        "material-icons",
        className,
        css`
          font-size: 18px;
          vertical-align: text-bottom;
        `,
      )}
    />
  ),
);

export const Menu = React.forwardRef<HTMLDivElement, MenuProps>(({ className, ...props }, ref) => {
  return (
    <div
      {...props}
      data-testid="menu"
      ref={ref}
      className={cx(
        className,
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
});
export const Portal = ({ children }: { children: React.ReactNode }) => {
  return typeof document === "object" ? ReactDOM.createPortal(children, document.body) : null;
};

export const Toolbar = React.forwardRef<HTMLDivElement, MenuProps>(
  ({ className, ...props }, ref) => (
    <Menu
      {...props}
      ref={ref}
      className={cx(
        className,
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
