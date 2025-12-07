import React from "react";

export function Frame({
  children,
  className,
  description,
}: {
  children: React.ReactNode;
  className?: string;
  description?: string;
}) {
  return (
    <>
      <div
        className={`flex space-x-4 w-full mx-auto justify-center ${className}`}
      >
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            const childElement = child as React.ReactElement<{ className?: string }>;
            return React.cloneElement(childElement, {
              className: `border border-foreground-muted rounded-md shadow-lg ${
                childElement.props.className || ""
              }`,
            });
          }
          return child;
        })}
      </div>
      {description && <p className="text-sm text-neutral-500 text-center">{description}</p>}
    </>
  );
}
