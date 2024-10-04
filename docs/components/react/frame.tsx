import React from "react";

export function Frame({
  children,
  className,
  description,
}: {
  children: React.ReactNode;
  className: string;
  description?: string;
}) {
  return (
    <>
      <div
        className={`flex space-x-4 w-full mx-auto justify-center ${className}`}
      >
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<any>, {
                className: `border border-neutral-200 rounded-md shadow-lg bg-white ${
                  child.props.className || ""
                }`,
              })
            : child
        )}
      </div>
      {description && <p className="text-sm text-neutral-500 text-center">{description}</p>}
    </>
  );
}
