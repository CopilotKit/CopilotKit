import React from "react";

export function Frame({ children, className }: { children: React.ReactNode, className: string }) {
  return (
  <div className={`flex space-x-4 w-full mx-auto justify-center my-4 ${className}`}>
    {React.Children.map(children, (child) =>
      React.isValidElement(child) ? React.cloneElement(child as React.ReactElement<any>, {
        className: `border border-neutral-200 rounded-md shadow-lg ${child.props.className || ""}`
      }) : child
    )}
  </div>
  );
}
